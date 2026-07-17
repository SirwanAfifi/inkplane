import { setIcon } from "obsidian";
import { cloneDrawing, emptyDrawing } from "./file-format";
import {
  cloneStrokes,
  combinedBounds,
  createInkPoint,
  createStroke,
  eraseStrokeAt,
  pointInBounds,
  removeSharpBacktracks,
  selectStrokesInPolygon,
  simplifyPoints,
  translateStrokes
} from "./model";
import { applyPressureSensitivity, stabilizePointerPressure } from "./pressure";
import { coalescedEvents } from "./pointer-samples";
import { exportStrokesToSvg, InkRenderer, type InkRenderState } from "./render";
import type { InkStore } from "./storage";
import { ToolInspector, toolWidth } from "./tool-inspector";
import type { InkDrawing, InkPoint, InkSettings, InkStroke, InkTool, Point2D } from "./types";

const HISTORY_LIMIT = 75;
const PALM_REJECTION_WINDOW_MS = 900;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;

interface QuickColorChoice {
  label: string;
  value: string;
}

const PEN_QUICK_COLORS: QuickColorChoice[] = [
  { label: "Match theme", value: "adaptive" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Yellow", value: "#facc15" },
  { label: "Red", value: "#dc2626" }
];

const HIGHLIGHTER_QUICK_COLORS: QuickColorChoice[] = [
  { label: "Yellow", value: "#facc15" },
  { label: "Lime", value: "#a3e635" },
  { label: "Cyan", value: "#22d3ee" },
  { label: "Blue", value: "#60a5fa" },
  { label: "Pink", value: "#f472b6" }
];

type GestureMode = "draw" | "erase" | "lasso" | "move-selection" | null;

export interface DrawingSurfaceCallbacks {
  onChange(drawing: InkDrawing): void;
  onToolChange?(tool: InkTool): void;
  onSettingsChange?(): void;
}

export class DrawingSurface {
  readonly root: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly dryCanvas: HTMLCanvasElement;
  private readonly wetCanvas: HTMLCanvasElement;
  private readonly toolbar: HTMLDivElement;
  private toolbarGroup: HTMLDivElement | null = null;
  private readonly toolInspector: ToolInspector;
  private readonly renderer: InkRenderer;
  private readonly toolButtons = new Map<InkTool, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly paletteButton: HTMLButtonElement;
  private readonly quickColorButtons: HTMLButtonElement[] = [];
  private readonly zoomButton: HTMLButtonElement;
  private readonly emptyState: HTMLDivElement;
  private readonly statusLabel: HTMLSpanElement;
  private readonly statusMeta: HTMLSpanElement;
  private readonly resizeObserver: ResizeObserver;
  private drawing: InkDrawing;
  private tool: InkTool = "pen";
  private draft: InkStroke | null = null;
  private selectedIds = new Set<string>();
  private lassoPoints: Point2D[] = [];
  private eraserPoint: Point2D | null = null;
  private activePointerId: number | null = null;
  private activePointerType = "";
  private activeRawPressure: number | null = null;
  private gestureMode: GestureMode = null;
  private gestureBefore: InkStroke[] | null = null;
  private gestureChanged = false;
  private dragPrevious: Point2D | null = null;
  private lastPenSignal = 0;
  private undoStack: InkStroke[][] = [];
  private redoStack: InkStroke[][] = [];
  private navigationPointers = new Map<number, Point2D>();
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private spacePressed = false;
  private shouldFit = true;
  private animationFrame: number | null = null;
  private dryLayerDirty = true;
  private destroyed = false;

  private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent): void => this.onPointerMove(event);
  private readonly handlePointerUp = (event: PointerEvent): void => this.onPointerUp(event);
  private readonly handlePointerCancel = (event: PointerEvent): void => this.onPointerCancel(event);
  private readonly handlePointerLeave = (event: PointerEvent): void => this.onPointerLeave(event);
  private readonly handleWheel = (event: WheelEvent): void => this.onWheel(event);
  private readonly handleKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
  private readonly handleKeyUp = (event: KeyboardEvent): void => this.onKeyUp(event);

  constructor(
    host: HTMLElement,
    private readonly store: InkStore,
    private readonly callbacks: DrawingSurfaceCallbacks,
    drawing?: InkDrawing
  ) {
    const doc = host.ownerDocument;
    this.drawing = cloneDrawing(drawing ?? emptyDrawing(
      store.settings.defaultCanvasWidth,
      store.settings.defaultCanvasHeight
    ));

    this.root = doc.createElement("div");
    this.root.className = "ink-canvas-view";
    this.root.tabIndex = 0;

    this.viewport = doc.createElement("div");
    this.viewport.className = "ink-canvas-viewport";
    this.viewport.setAttribute("aria-label", "Ink drawing canvas");
    this.root.appendChild(this.viewport);

    this.dryCanvas = doc.createElement("canvas");
    this.dryCanvas.className = "ink-canvas-layer ink-canvas-layer-dry";
    this.dryCanvas.setAttribute("aria-hidden", "true");
    this.viewport.appendChild(this.dryCanvas);

    this.wetCanvas = doc.createElement("canvas");
    this.wetCanvas.className = "ink-canvas-layer";
    this.wetCanvas.setAttribute("aria-hidden", "true");
    this.viewport.appendChild(this.wetCanvas);

    this.toolbar = doc.createElement("div");
    this.toolbar.className = "ink-layer-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Ink tools");
    this.root.appendChild(this.toolbar);

    this.startToolbarGroup("History", "ink-toolbar-history");
    this.undoButton = this.addActionButton("undo-2", "Undo ink", () => this.undo());
    this.redoButton = this.addActionButton("redo-2", "Redo ink", () => this.redo());
    this.deleteButton = this.addActionButton("trash-2", "Delete selection", () => this.deleteSelection());

    this.startToolbarGroup("Drawing tools", "ink-toolbar-instruments");
    this.addToolButton("pen", "pen-tool", "Pen");
    this.addToolButton("highlighter", "highlighter", "Highlighter");
    this.addToolButton("eraser", "eraser", "Eraser");
    this.addToolButton("lasso", "lasso", "Lasso select");
    this.addToolButton("pan", "hand", "Pan canvas");

    this.startToolbarGroup("Quick colors", "ink-toolbar-colors");
    for (let index = 0; index < PEN_QUICK_COLORS.length; index += 1) {
      this.quickColorButtons.push(this.addQuickColorButton(index));
    }
    this.paletteButton = this.addActionButton("sliders-horizontal", "More colors and sizes", () => {
      if (this.tool === "lasso" || this.tool === "pan") this.setTool("pen");
      this.toolInspector.toggle(this.tool);
    });
    this.paletteButton.classList.add("ink-color-more");
    this.paletteButton.setAttribute("aria-haspopup", "dialog");
    this.paletteButton.setAttribute("aria-expanded", "false");

    this.startToolbarGroup("Canvas view", "ink-toolbar-view");
    this.addActionButton("minus", "Zoom out", () => this.zoomBy(0.8));
    this.zoomButton = this.addTextButton("100%", "Fit drawing", () => this.fitToView());
    this.addActionButton("plus", "Zoom in", () => this.zoomBy(1.25));

    this.emptyState = doc.createElement("div");
    this.emptyState.className = "ink-canvas-empty-state";
    this.emptyState.setAttribute("aria-hidden", "true");
    const emptyIcon = doc.createElement("span");
    emptyIcon.className = "ink-empty-icon";
    setIcon(emptyIcon, "pen-tool");
    const emptyTitle = doc.createElement("strong");
    emptyTitle.textContent = "Draw with Apple Pencil";
    const emptyHint = doc.createElement("span");
    emptyHint.textContent = "One finger pans · two fingers zoom";
    this.emptyState.append(emptyIcon, emptyTitle, emptyHint);
    this.viewport.appendChild(this.emptyState);

    const status = doc.createElement("div");
    status.className = "ink-canvas-status";
    this.statusLabel = doc.createElement("span");
    this.statusLabel.className = "ink-canvas-status-tool";
    this.statusMeta = doc.createElement("span");
    this.statusMeta.className = "ink-canvas-status-meta";
    status.append(this.statusLabel, this.statusMeta);
    this.root.appendChild(status);

    this.toolInspector = new ToolInspector(
      this.root,
      () => this.settings,
      (patch) => this.applyToolSetting(patch),
      () => this.updateToolbar(),
      this.paletteButton
    );
    this.toolbar.addEventListener("scroll", () => this.toolInspector.reposition(), { passive: true });

    host.replaceChildren(this.root);
    this.renderer = new InkRenderer(this.dryCanvas, this.wetCanvas, this.root);

    this.viewport.addEventListener("pointerdown", this.handlePointerDown, { capture: true });
    this.viewport.addEventListener("pointermove", this.handlePointerMove, { capture: true });
    this.viewport.addEventListener("pointerup", this.handlePointerUp, { capture: true });
    this.viewport.addEventListener("pointercancel", this.handlePointerCancel, { capture: true });
    this.viewport.addEventListener("pointerleave", this.handlePointerLeave, { capture: true });
    this.viewport.addEventListener("wheel", this.handleWheel, { passive: false });
    this.root.addEventListener("keydown", this.handleKeyDown, { capture: true });
    this.root.addEventListener("keyup", this.handleKeyUp, { capture: true });

    this.resizeObserver = new ResizeObserver(() => {
      this.toolInspector.reposition();
      if (this.shouldFit) this.fitToView();
      else {
        this.dryLayerDirty = true;
        this.scheduleRender();
      }
    });
    this.resizeObserver.observe(this.viewport);

    this.refreshSettings();
    this.updateToolbar();
    this.scheduleRender();
  }

  get currentTool(): InkTool {
    return this.tool;
  }

  get hasInk(): boolean {
    return this.drawing.strokes.length > 0;
  }

  getDrawing(): InkDrawing {
    return cloneDrawing(this.drawing);
  }

  setDrawing(drawing: InkDrawing, clearHistory = true): void {
    this.cancelGesture();
    this.drawing = cloneDrawing(drawing);
    this.selectedIds.clear();
    if (clearHistory) {
      this.undoStack = [];
      this.redoStack = [];
      this.shouldFit = true;
    }
    this.dryLayerDirty = true;
    this.updateToolbar();
    this.scheduleRender();
  }

  setTool(tool: InkTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    if (tool !== "lasso") this.selectedIds.clear();
    if (tool !== "eraser") this.eraserPoint = null;
    this.toolInspector.switchTool(tool);
    this.updateToolbar();
    this.callbacks.onToolChange?.(tool);
    this.scheduleRender();
  }

  refreshSettings(): void {
    this.root.classList.toggle("toolbar-at-bottom", this.settings.toolbarPosition === "bottom");
    this.toolInspector.refresh();
    this.updateToolbar();
    this.dryLayerDirty = true;
    this.scheduleRender();
  }

  undo(): void {
    if (this.undoStack.length === 0 || this.activePointerId !== null) return;
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneStrokes(this.drawing.strokes));
    this.drawing.strokes = cloneStrokes(previous);
    this.selectedIds.clear();
    this.notifyChange();
  }

  redo(): void {
    if (this.redoStack.length === 0 || this.activePointerId !== null) return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneStrokes(this.drawing.strokes));
    this.drawing.strokes = cloneStrokes(next);
    this.selectedIds.clear();
    this.notifyChange();
  }

  deleteSelection(): void {
    if (this.selectedIds.size === 0) return;
    const before = cloneStrokes(this.drawing.strokes);
    this.drawing.strokes = this.drawing.strokes.filter((stroke) => !this.selectedIds.has(stroke.id));
    this.selectedIds.clear();
    this.commit(before);
  }

  clearAll(): void {
    if (this.drawing.strokes.length === 0) return;
    const before = cloneStrokes(this.drawing.strokes);
    this.drawing.strokes = [];
    this.selectedIds.clear();
    this.commit(before);
  }

  exportSvg(): string | null {
    return exportStrokesToSvg(this.drawing.strokes, this.root);
  }

  fitToView(): void {
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const padding = Math.min(72, Math.max(24, rect.width * 0.06));
    const bounds = combinedBounds(this.drawing.strokes);
    if (bounds) {
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      this.scale = clamp(Math.min(
        (rect.width - padding * 2) / width,
        (rect.height - padding * 2) / height,
        1
      ), MIN_ZOOM, MAX_ZOOM);
      this.offsetX = (rect.width - width * this.scale) / 2 - bounds.minX * this.scale;
      this.offsetY = (rect.height - height * this.scale) / 2 - bounds.minY * this.scale;
    } else {
      this.scale = 1;
      this.offsetX = rect.width / 2 - this.drawing.width / 2;
      this.offsetY = rect.height / 2 - this.drawing.height / 2;
    }
    this.shouldFit = false;
    this.markCameraChanged();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelGesture();
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.viewport.removeEventListener("pointerdown", this.handlePointerDown, { capture: true });
    this.viewport.removeEventListener("pointermove", this.handlePointerMove, { capture: true });
    this.viewport.removeEventListener("pointerup", this.handlePointerUp, { capture: true });
    this.viewport.removeEventListener("pointercancel", this.handlePointerCancel, { capture: true });
    this.viewport.removeEventListener("pointerleave", this.handlePointerLeave, { capture: true });
    this.viewport.removeEventListener("wheel", this.handleWheel);
    this.root.removeEventListener("keydown", this.handleKeyDown, { capture: true });
    this.root.removeEventListener("keyup", this.handleKeyUp, { capture: true });
    this.root.remove();
  }

  private get settings(): InkSettings {
    return this.store.settings;
  }

  private addToolButton(tool: InkTool, icon: string, label: string): void {
    const button = this.addActionButton(icon, label, () => this.setTool(tool));
    button.dataset.tool = tool;
    button.setAttribute("aria-pressed", "false");
    const indicator = this.toolbar.ownerDocument.createElement("span");
    indicator.className = "ink-tool-selection-indicator";
    indicator.setAttribute("aria-hidden", "true");
    button.appendChild(indicator);
    this.toolButtons.set(tool, button);
  }

  private addQuickColorButton(index: number): HTMLButtonElement {
    const button = this.toolbar.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "ink-quick-color";
    button.dataset.colorIndex = String(index);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", (event) => {
      consumeEvent(event);
      const targetTool = this.tool === "highlighter" ? "highlighter" : "pen";
      const choice = this.quickColors(targetTool)[index];
      if (!choice) return;
      if (this.tool !== targetTool) this.setTool(targetTool);
      this.applyToolSetting(targetTool === "pen"
        ? { penColor: choice.value }
        : { highlighterColor: choice.value });
      this.updateToolbar();
      this.root.focus({ preventScroll: true });
    });
    (this.toolbarGroup ?? this.toolbar).appendChild(button);
    return button;
  }

  private addActionButton(
    icon: string,
    label: string,
    action: (event: MouseEvent) => void
  ): HTMLButtonElement {
    const button = this.toolbar.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "ink-layer-tool clickable-icon";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.dataset.inkTooltip = label;
    try {
      setIcon(button, icon);
    } catch {
      // Older mobile Obsidian builds can lack newer Lucide icon identifiers.
    }
    if (!button.querySelector("svg")) {
      const fallback = this.toolbar.ownerDocument.createElement("span");
      fallback.className = "ink-tool-glyph";
      fallback.textContent = fallbackIcon(icon);
      fallback.setAttribute("aria-hidden", "true");
      button.appendChild(fallback);
    }
    button.addEventListener("click", (event) => {
      consumeEvent(event);
      action(event);
      this.root.focus({ preventScroll: true });
    });
    (this.toolbarGroup ?? this.toolbar).appendChild(button);
    return button;
  }

  private addTextButton(text: string, label: string, action: () => void): HTMLButtonElement {
    const button = this.toolbar.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "ink-layer-tool ink-layer-zoom";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.addEventListener("click", (event) => {
      consumeEvent(event);
      action();
      this.root.focus({ preventScroll: true });
    });
    (this.toolbarGroup ?? this.toolbar).appendChild(button);
    return button;
  }

  private startToolbarGroup(label: string, className = ""): void {
    const group = this.toolbar.ownerDocument.createElement("div");
    group.className = `ink-toolbar-group ${className}`.trim();
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    this.toolbar.appendChild(group);
    this.toolbarGroup = group;
  }

  private quickColors(tool: "pen" | "highlighter"): QuickColorChoice[] {
    return tool === "highlighter" ? HIGHLIGHTER_QUICK_COLORS : PEN_QUICK_COLORS;
  }

  private applyToolSetting(patch: Partial<InkSettings>): void {
    this.store.updateSettings(patch);
    if (this.callbacks.onSettingsChange) this.callbacks.onSettingsChange();
    else this.refreshSettings();
  }

  private onPointerDown(event: PointerEvent): void {
    this.toolInspector.close();
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    this.root.focus({ preventScroll: true });

    if (this.shouldRejectPalm(event)) {
      consumeEvent(event);
      return;
    }
    if (this.shouldNavigate(event)) {
      consumeEvent(event);
      this.beginNavigation(event);
      return;
    }
    if (!this.canDrawWith(event) || this.activePointerId !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    consumeEvent(event);
    this.activePointerId = event.pointerId;
    this.activePointerType = event.pointerType;
    this.gestureBefore = cloneStrokes(this.drawing.strokes);
    this.gestureChanged = false;
    this.capturePointer(event.pointerId);

    const point = this.toDrawingPoint(event);
    const gestureTool = isEraserButton(event) ? "eraser" : this.tool;
    if (gestureTool === "pen" || gestureTool === "highlighter") {
      this.gestureMode = "draw";
      this.activeRawPressure = null;
      this.selectedIds.clear();
      this.draft = createStroke(
        gestureTool,
        gestureTool === "pen" ? this.settings.penColor : this.settings.highlighterColor,
        gestureTool === "pen" ? this.settings.penWidth : this.settings.highlighterWidth,
        gestureTool === "pen" ? 1 : 0.34,
        [this.eventToInkPoint(event)]
      );
    } else if (gestureTool === "eraser") {
      this.gestureMode = "erase";
      this.selectedIds.clear();
      this.eraserPoint = point;
      this.eraseAt(point);
    } else if (gestureTool === "lasso") {
      const bounds = combinedBounds(this.drawing.strokes.filter((stroke) => this.selectedIds.has(stroke.id)));
      if (bounds && pointInBounds(point, bounds, 12 / this.scale)) {
        this.gestureMode = "move-selection";
        this.dragPrevious = point;
      } else {
        this.gestureMode = "lasso";
        this.selectedIds.clear();
        this.lassoPoints = [point];
      }
    }
    this.updateToolbar();
    this.scheduleRender();
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    if (this.navigationPointers.has(event.pointerId)) {
      consumeEvent(event);
      this.updateNavigation(event);
      return;
    }
    if (this.shouldRejectPalm(event)) {
      consumeEvent(event);
      return;
    }
    if (this.activePointerId !== event.pointerId) {
      if (this.tool === "eraser" && this.canDrawWith(event)) {
        this.eraserPoint = this.toDrawingPoint(event);
        this.scheduleRender();
      }
      return;
    }

    consumeEvent(event);
    const events = coalescedEvents(event);
    if (this.gestureMode === "draw" && this.draft) {
      for (const sample of events) this.appendDraftPoint(this.eventToInkPoint(sample));
    } else if (this.gestureMode === "erase") {
      for (const sample of events) {
        const point = this.toDrawingPoint(sample);
        this.eraserPoint = point;
        this.eraseAt(point);
      }
    } else if (this.gestureMode === "lasso") {
      for (const sample of events) this.appendLassoPoint(this.toDrawingPoint(sample));
    } else if (this.gestureMode === "move-selection") {
      const point = this.toDrawingPoint(event);
      if (this.dragPrevious) {
        const dx = point.x - this.dragPrevious.x;
        const dy = point.y - this.dragPrevious.y;
        if (dx !== 0 || dy !== 0) {
          translateStrokes(this.drawing.strokes, this.selectedIds, dx, dy);
          this.gestureChanged = true;
          this.dryLayerDirty = true;
        }
      }
      this.dragPrevious = point;
    }
    this.scheduleRender();
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    if (this.navigationPointers.has(event.pointerId)) {
      consumeEvent(event);
      this.endNavigation(event.pointerId);
      return;
    }
    if (this.activePointerId !== event.pointerId) return;
    consumeEvent(event);

    if (this.gestureMode === "draw" && this.draft) {
      for (const sample of coalescedEvents(event)) {
        this.appendDraftPoint(this.eventToInkPoint(sample));
      }
      this.draft.points = simplifyPoints(
        removeSharpBacktracks(this.draft.points, this.draft.width),
        this.draft.tool === "pen"
          ? Math.max(0.45, Math.min(1.5, this.draft.width * 0.42))
          : Math.max(0.35 / this.scale, 0.45)
      );
      if (this.draft.points.length > 0) {
        this.drawing.strokes.push(this.draft);
        this.gestureChanged = true;
      }
    } else if (this.gestureMode === "lasso") {
      this.appendLassoPoint(this.toDrawingPoint(event));
      this.selectedIds = selectStrokesInPolygon(this.drawing.strokes, this.lassoPoints);
    }
    this.finishGesture();
  }

  private onPointerCancel(event: PointerEvent): void {
    if (this.navigationPointers.has(event.pointerId)) {
      this.endNavigation(event.pointerId);
      return;
    }
    if (this.activePointerId !== event.pointerId) return;
    this.cancelGesture();
    this.dryLayerDirty = true;
    this.updateToolbar();
    this.scheduleRender();
  }

  private onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    if (this.activePointerId === null && !this.navigationPointers.has(event.pointerId)) {
      this.eraserPoint = null;
      this.scheduleRender();
    }
  }

  private onWheel(event: WheelEvent): void {
    consumeEvent(event);
    if (event.ctrlKey || event.metaKey) {
      const rect = this.viewport.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.setZoom(this.scale * Math.exp(-event.deltaY * 0.002), anchor);
    } else {
      this.offsetX -= event.deltaX;
      this.offsetY -= event.deltaY;
      this.markCameraChanged();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && event.key.toLowerCase() === "z") {
      consumeEvent(event);
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && this.selectedIds.size > 0) {
      consumeEvent(event);
      this.deleteSelection();
      return;
    }
    if (event.key === "0" && commandKey) {
      consumeEvent(event);
      this.fitToView();
      return;
    }
    if (event.code === "Space" && !event.repeat) {
      consumeEvent(event);
      this.spacePressed = true;
      this.root.classList.add("is-panning");
      return;
    }
    if (event.key === "Escape" && this.toolInspector.isOpen) {
      consumeEvent(event);
      this.toolInspector.close();
      return;
    }
    if (event.key === "Escape" && this.selectedIds.size > 0) {
      consumeEvent(event);
      this.selectedIds.clear();
      this.updateToolbar();
      this.scheduleRender();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.code !== "Space") return;
    this.spacePressed = false;
    this.root.classList.remove("is-panning");
  }

  private beginNavigation(event: PointerEvent): void {
    this.navigationPointers.set(event.pointerId, this.toViewportPoint(event));
    this.capturePointer(event.pointerId);
    this.root.classList.add("is-panning");
  }

  private updateNavigation(event: PointerEvent): void {
    const previousPoints = [...this.navigationPointers.values()];
    this.navigationPointers.set(event.pointerId, this.toViewportPoint(event));
    const nextPoints = [...this.navigationPointers.values()];
    if (previousPoints.length >= 2 && nextPoints.length >= 2) {
      const oldCenter = midpoint(previousPoints[0], previousPoints[1]);
      const newCenter = midpoint(nextPoints[0], nextPoints[1]);
      const oldDistance = Math.max(1, distance(previousPoints[0], previousPoints[1]));
      const newDistance = Math.max(1, distance(nextPoints[0], nextPoints[1]));
      const world = {
        x: (oldCenter.x - this.offsetX) / this.scale,
        y: (oldCenter.y - this.offsetY) / this.scale
      };
      this.scale = clamp(this.scale * (newDistance / oldDistance), MIN_ZOOM, MAX_ZOOM);
      this.offsetX = newCenter.x - world.x * this.scale;
      this.offsetY = newCenter.y - world.y * this.scale;
    } else if (previousPoints[0] && nextPoints[0]) {
      this.offsetX += nextPoints[0].x - previousPoints[0].x;
      this.offsetY += nextPoints[0].y - previousPoints[0].y;
    }
    this.markCameraChanged();
  }

  private endNavigation(pointerId: number): void {
    this.navigationPointers.delete(pointerId);
    this.releasePointer(pointerId);
    if (this.navigationPointers.size === 0) this.root.classList.remove("is-panning");
  }

  private finishGesture(): void {
    const pointerId = this.activePointerId;
    if (pointerId !== null) this.releasePointer(pointerId);
    if (this.gestureChanged && this.gestureBefore) this.commit(this.gestureBefore);
    this.activePointerId = null;
    this.activePointerType = "";
    this.activeRawPressure = null;
    this.gestureMode = null;
    this.gestureBefore = null;
    this.gestureChanged = false;
    this.draft = null;
    this.lassoPoints = [];
    this.dragPrevious = null;
    if (this.tool !== "eraser") this.eraserPoint = null;
    this.updateToolbar();
    this.scheduleRender();
  }

  private cancelGesture(): void {
    if (this.gestureBefore && this.gestureChanged) this.drawing.strokes = cloneStrokes(this.gestureBefore);
    if (this.activePointerId !== null) this.releasePointer(this.activePointerId);
    for (const pointerId of this.navigationPointers.keys()) this.releasePointer(pointerId);
    this.navigationPointers.clear();
    this.activePointerId = null;
    this.activePointerType = "";
    this.activeRawPressure = null;
    this.gestureMode = null;
    this.gestureBefore = null;
    this.gestureChanged = false;
    this.draft = null;
    this.lassoPoints = [];
    this.dragPrevious = null;
    this.eraserPoint = null;
    this.root.classList.remove("is-panning");
  }

  private appendDraftPoint(point: InkPoint): void {
    if (!this.draft) return;
    const previous = this.draft.points[this.draft.points.length - 1];
    if (previous && squaredDistance(previous, point) < 0.04 / (this.scale * this.scale)) return;
    if (previous && point.time < previous.time) return;
    this.draft.points.push(point);
  }

  private appendLassoPoint(point: Point2D): void {
    const previous = this.lassoPoints[this.lassoPoints.length - 1];
    if (previous && squaredDistance(previous, point) < 4 / (this.scale * this.scale)) return;
    this.lassoPoints.push(point);
  }

  private eraseAt(point: Point2D): void {
    const radius = this.settings.eraserWidth / 2;
    const nextStrokes: InkStroke[] = [];
    let changed = false;

    for (const stroke of this.drawing.strokes) {
      const fragments = eraseStrokeAt(stroke, point, radius);
      if (fragments.length !== 1 || fragments[0] !== stroke) changed = true;
      nextStrokes.push(...fragments);
    }

    if (changed) {
      this.drawing.strokes = nextStrokes;
      this.gestureChanged = true;
      this.dryLayerDirty = true;
    }
  }

  private commit(before: InkStroke[]): void {
    this.undoStack.push(cloneStrokes(before));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.notifyChange();
  }

  private notifyChange(): void {
    this.drawing.updatedAt = Date.now();
    this.dryLayerDirty = true;
    this.callbacks.onChange(this.getDrawing());
    this.updateToolbar();
    this.scheduleRender();
  }

  private updateToolbar(): void {
    this.root.classList.toggle("is-pan-tool", this.tool === "pan");
    for (const [tool, button] of this.toolButtons) {
      const selected = tool === this.tool;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const instrumentColor = tool === "pen"
        ? this.settings.penColor
        : tool === "highlighter"
          ? this.settings.highlighterColor
          : "adaptive";
      button.style.setProperty(
        "--ink-instrument-color",
        instrumentColor === "adaptive" ? "var(--text-normal)" : instrumentColor
      );
    }
    this.undoButton.disabled = this.undoStack.length === 0;
    this.redoButton.disabled = this.redoStack.length === 0;
    this.deleteButton.disabled = this.selectedIds.size === 0;
    this.paletteButton.classList.toggle("is-selected", this.toolInspector.isOpen);
    this.paletteButton.setAttribute("aria-expanded", this.toolInspector.isOpen ? "true" : "false");
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>("[data-ink-tooltip]")) {
      if (this.toolInspector.isOpen) button.removeAttribute("title");
      else if (button.dataset.inkTooltip) button.setAttribute("title", button.dataset.inkTooltip);
    }
    const colorTool = this.tool === "highlighter" ? "highlighter" : "pen";
    const quickColors = this.quickColors(colorTool);
    const activeColor = colorTool === "highlighter" ? this.settings.highlighterColor : this.settings.penColor;
    for (const button of this.quickColorButtons) {
      const choice = quickColors[Number(button.dataset.colorIndex)];
      if (!choice) continue;
      const selected = choice.value.toLowerCase() === activeColor.toLowerCase();
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-adaptive", choice.value === "adaptive");
      button.style.setProperty("--ink-quick-color", choice.value === "adaptive" ? "var(--text-normal)" : choice.value);
      button.setAttribute("aria-label", choice.label);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.dataset.inkTooltip = choice.label;
      if (!this.toolInspector.isOpen) button.setAttribute("title", choice.label);
    }
    this.zoomButton.textContent = `${Math.round(this.scale * 100)}%`;
    const width = toolWidth(this.tool, this.settings);
    const labels: Record<InkTool, string> = {
      pen: "Pen",
      highlighter: "Highlighter",
      eraser: "Eraser",
      lasso: "Lasso select",
      pan: "Pan canvas"
    };
    this.statusLabel.textContent = width > 0 ? `${labels[this.tool]} · ${formatToolWidth(width)}` : labels[this.tool];
    this.statusMeta.textContent = "Infinite canvas";
    const hasInk = this.drawing.strokes.length > 0;
    this.root.classList.toggle("has-ink", hasInk);
    this.emptyState.setAttribute("aria-hidden", hasInk ? "true" : "false");
  }

  private zoomBy(factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    this.setZoom(this.scale * factor, { x: rect.width / 2, y: rect.height / 2 });
  }

  private setZoom(nextScale: number, anchor: Point2D): void {
    const worldX = (anchor.x - this.offsetX) / this.scale;
    const worldY = (anchor.y - this.offsetY) / this.scale;
    this.scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
    this.offsetX = anchor.x - worldX * this.scale;
    this.offsetY = anchor.y - worldY * this.scale;
    this.markCameraChanged();
  }

  private markCameraChanged(): void {
    this.shouldFit = false;
    this.dryLayerDirty = true;
    this.updateToolbar();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.animationFrame !== null || this.destroyed) return;
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.render();
    });
  }

  private render(): void {
    const rect = this.viewport.getBoundingClientRect();
    if (this.renderer.resize(rect.width, rect.height)) this.dryLayerDirty = true;
    const state: InkRenderState = {
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      selectedIds: this.selectedIds,
      lassoPoints: this.lassoPoints,
      eraserPoint: this.eraserPoint,
      eraserRadius: this.settings.eraserWidth / 2
    };
    this.renderer.render(this.drawing.strokes, this.draft, state, this.dryLayerDirty);
    this.dryLayerDirty = false;
  }

  private toViewportPoint(event: PointerEvent): Point2D {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toDrawingPoint(event: PointerEvent): Point2D {
    const point = this.toViewportPoint(event);
    return {
      x: (point.x - this.offsetX) / this.scale,
      y: (point.y - this.offsetY) / this.scale
    };
  }

  private eventToInkPoint(event: PointerEvent): InkPoint {
    const point = this.toDrawingPoint(event);
    let rawPressure = event.pressure > 0 ? event.pressure : 0.5;
    if (event.pointerType === "pen") {
      rawPressure = stabilizePointerPressure(event.pressure, this.activeRawPressure);
      this.activeRawPressure = rawPressure;
    }
    return createInkPoint(
      point.x,
      point.y,
      applyPressureSensitivity(rawPressure, this.settings.pressureSensitivity),
      event.tiltX,
      event.tiltY,
      event.timeStamp
    );
  }

  private canDrawWith(event: PointerEvent): boolean {
    if (event.pointerType === "pen") return true;
    if (event.pointerType === "touch") return this.settings.allowFingerDrawing;
    if (event.pointerType === "mouse") return this.settings.allowMouseDrawing;
    return false;
  }

  private shouldNavigate(event: PointerEvent): boolean {
    if (isEraserButton(event)) return false;
    if (event.pointerType === "touch") return !this.settings.allowFingerDrawing;
    return this.tool === "pan" || this.spacePressed || (event.pointerType === "mouse" && event.button === 1);
  }

  private shouldRejectPalm(event: PointerEvent): boolean {
    if (event.pointerType !== "touch" || !this.settings.palmRejection) return false;
    return this.activePointerType === "pen" ||
      (this.lastPenSignal > 0 && Date.now() - this.lastPenSignal < PALM_REJECTION_WINDOW_MS);
  }

  private capturePointer(pointerId: number): void {
    try {
      this.viewport.setPointerCapture(pointerId);
    } catch {
      // iOS WebViews can capture Pencil input implicitly.
    }
  }

  private releasePointer(pointerId: number): void {
    try {
      this.viewport.releasePointerCapture(pointerId);
    } catch {
      // The WebView may already have released capture.
    }
  }
}

function isEraserButton(event: PointerEvent): boolean {
  return event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);
}

function consumeEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function squaredDistance(first: Point2D, second: Point2D): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function distance(first: Point2D, second: Point2D): number {
  return Math.sqrt(squaredDistance(first, second));
}

function midpoint(first: Point2D, second: Point2D): Point2D {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatToolWidth(width: number): string {
  return `${Number.isInteger(width) ? width : width.toFixed(1)} px`;
}

function fallbackIcon(icon: string): string {
  const icons: Record<string, string> = {
    "pen-tool": "✎",
    highlighter: "▰",
    eraser: "◇",
    lasso: "⌁",
    hand: "✋",
    "sliders-horizontal": "☷",
    "undo-2": "↶",
    "redo-2": "↷",
    "trash-2": "⌫",
    minus: "−",
    plus: "+"
  };
  return icons[icon] ?? "•";
}
