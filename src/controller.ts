import { MarkdownView, Menu, setIcon } from "obsidian";
import {
  cloneStrokes,
  combinedBounds,
  createInkPoint,
  createStroke,
  hitTestStroke,
  pointInBounds,
  selectStrokesInPolygon,
  simplifyPoints,
  translateStrokes
} from "./model";
import { exportStrokesToSvg, InkRenderer, type InkRenderState } from "./render";
import type { InkStore } from "./storage";
import type { InkDocument, InkPoint, InkSettings, InkStroke, InkTool, Point2D } from "./types";

const HISTORY_LIMIT = 50;
const PALM_REJECTION_WINDOW_MS = 900;

type GestureMode = "draw" | "erase" | "lasso" | "move-selection" | null;

export interface InkControllerCallbacks {
  onActiveChange(controller: InkController, active: boolean): void;
  onToolChange(controller: InkController, tool: InkTool): void;
  onDocumentChange(controller: InkController, notePath: string): void;
}

export class InkController {
  private readonly host: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly dryCanvas: HTMLCanvasElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly toolbar: HTMLDivElement;
  private readonly renderer: InkRenderer;
  private readonly toolButtons = new Map<InkTool, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly paletteButton: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private scroller: HTMLElement;
  private document: InkDocument;
  private active = false;
  private tool: InkTool = "pen";
  private draft: InkStroke | null = null;
  private selectedIds = new Set<string>();
  private lassoPoints: Point2D[] = [];
  private eraserPoint: Point2D | null = null;
  private activePointerId: number | null = null;
  private activePointerType = "";
  private gestureMode: GestureMode = null;
  private gestureBefore: InkStroke[] | null = null;
  private gestureChanged = false;
  private dragPrevious: Point2D | null = null;
  private lastPenSignal = 0;
  private undoStack: InkStroke[][] = [];
  private redoStack: InkStroke[][] = [];
  private animationFrame: number | null = null;
  private dryLayerDirty = true;
  private destroyed = false;

  private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent): void => this.onPointerMove(event);
  private readonly handlePointerUp = (event: PointerEvent): void => this.onPointerUp(event);
  private readonly handlePointerCancel = (event: PointerEvent): void => this.onPointerUp(event);
  private readonly handlePointerLeave = (event: PointerEvent): void => this.onPointerLeave(event);
  private readonly handleScroll = (): void => {
    this.dryLayerDirty = true;
    this.scheduleRender();
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);

  constructor(
    readonly view: MarkdownView,
    private readonly store: InkStore,
    private readonly callbacks: InkControllerCallbacks
  ) {
    this.host = view.contentEl;
    this.host.classList.add("ink-layer-host");

    this.layer = document.createElement("div");
    this.layer.className = "ink-layer";

    this.dryCanvas = document.createElement("canvas");
    this.dryCanvas.className = "ink-layer-canvas ink-layer-canvas-dry";
    this.dryCanvas.setAttribute("aria-hidden", "true");
    this.layer.appendChild(this.dryCanvas);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "ink-layer-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.layer.appendChild(this.canvas);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "ink-layer-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Ink tools");
    this.toolbar.setAttribute("aria-hidden", "false");
    this.layer.appendChild(this.toolbar);

    this.addToolButton("pen", "pen-tool", "Pen");
    this.addToolButton("highlighter", "highlighter", "Highlighter");
    this.addToolButton("eraser", "eraser", "Stroke eraser");
    this.addToolButton("lasso", "lasso", "Lasso select");
    this.paletteButton = this.addActionButton("palette", "Color and size", (event) => this.openToolOptions(event));
    this.addDivider();
    this.undoButton = this.addActionButton("undo-2", "Undo ink", () => this.undo());
    this.redoButton = this.addActionButton("redo-2", "Redo ink", () => this.redo());
    this.deleteButton = this.addActionButton("trash-2", "Delete selection", () => this.deleteSelection());
    this.addDivider();
    this.addActionButton("check", "Done drawing", () => this.setActive(false));

    this.host.appendChild(this.layer);
    this.renderer = new InkRenderer(this.dryCanvas, this.canvas, this.host);
    this.scroller = this.findScroller();
    this.document = this.store.getDocument(this.view.file?.path ?? "");

    this.host.addEventListener("pointerdown", this.handlePointerDown, { capture: true });
    this.host.addEventListener("pointermove", this.handlePointerMove, { capture: true });
    this.host.addEventListener("pointerup", this.handlePointerUp, { capture: true });
    this.host.addEventListener("pointercancel", this.handlePointerCancel, { capture: true });
    this.host.addEventListener("pointerleave", this.handlePointerLeave, { capture: true });
    this.host.addEventListener("keydown", this.handleKeyDown, { capture: true });
    this.scroller.addEventListener("scroll", this.handleScroll, { passive: true });

    this.resizeObserver = new ResizeObserver(() => {
      this.dryLayerDirty = true;
      this.scheduleRender();
    });
    this.resizeObserver.observe(this.host);
    if (this.scroller !== this.host) this.resizeObserver.observe(this.scroller);
    this.mutationObserver = new MutationObserver(() => {
      this.refreshScroller();
      this.dryLayerDirty = true;
      this.scheduleRender();
    });
    this.mutationObserver.observe(this.host, { childList: true, subtree: true });

    this.refreshSettings();
    this.updateToolbar();
    this.scheduleRender();
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentTool(): InkTool {
    return this.tool;
  }

  get notePath(): string {
    return this.document.notePath;
  }

  get hasInk(): boolean {
    return this.document.strokes.length > 0;
  }

  exportSvg(): string | null {
    return exportStrokesToSvg(this.document.strokes, this.host);
  }

  setActive(active: boolean): void {
    if (this.active === active || this.destroyed) return;
    if (!active && this.activePointerId !== null) this.finishGesture();
    this.active = active;
    this.layer.classList.toggle("is-active", active);
    this.host.classList.toggle("ink-layer-input-active", active);
    this.updateVisibility();
    this.callbacks.onActiveChange(this, active);
    this.scheduleRender();
  }

  toggleActive(): void {
    this.setActive(!this.active);
  }

  setTool(tool: InkTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    if (tool !== "lasso") this.selectedIds.clear();
    this.eraserCursorForTool();
    this.updateToolbar();
    this.callbacks.onToolChange(this, tool);
    this.scheduleRender();
  }

  refreshSettings(): void {
    const position = this.settings.toolbarPosition;
    this.layer.classList.toggle("toolbar-at-bottom", position === "bottom");
    this.dryLayerDirty = true;
    this.updateVisibility();
    this.scheduleRender();
  }

  reloadDocument(): void {
    const path = this.view.file?.path ?? "";
    if (path === this.document.notePath) return;
    this.cancelGesture();
    this.document = this.store.getDocument(path);
    this.dryLayerDirty = true;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.updateToolbar();
    this.updateVisibility();
    this.scheduleRender();
  }

  refreshDocumentFromStore(notePath: string): void {
    if (notePath !== this.document.notePath || this.activePointerId !== null) return;
    this.document = this.store.getDocument(notePath);
    this.dryLayerDirty = true;
    this.selectedIds.clear();
    this.updateToolbar();
    this.updateVisibility();
    this.scheduleRender();
  }

  undo(): void {
    if (this.undoStack.length === 0 || this.activePointerId !== null) return;
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneStrokes(this.document.strokes));
    this.document.strokes = cloneStrokes(previous);
    this.selectedIds.clear();
    this.saveDocument();
  }

  redo(): void {
    if (this.redoStack.length === 0 || this.activePointerId !== null) return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneStrokes(this.document.strokes));
    this.document.strokes = cloneStrokes(next);
    this.selectedIds.clear();
    this.saveDocument();
  }

  deleteSelection(): void {
    if (this.selectedIds.size === 0) return;
    const before = cloneStrokes(this.document.strokes);
    this.document.strokes = this.document.strokes.filter((stroke) => !this.selectedIds.has(stroke.id));
    this.selectedIds.clear();
    this.commit(before);
  }

  clearAll(): void {
    if (this.document.strokes.length === 0) return;
    const before = cloneStrokes(this.document.strokes);
    this.document.strokes = [];
    this.selectedIds.clear();
    this.commit(before);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelGesture();
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.scroller.removeEventListener("scroll", this.handleScroll);
    this.host.removeEventListener("pointerdown", this.handlePointerDown, { capture: true });
    this.host.removeEventListener("pointermove", this.handlePointerMove, { capture: true });
    this.host.removeEventListener("pointerup", this.handlePointerUp, { capture: true });
    this.host.removeEventListener("pointercancel", this.handlePointerCancel, { capture: true });
    this.host.removeEventListener("pointerleave", this.handlePointerLeave, { capture: true });
    this.host.removeEventListener("keydown", this.handleKeyDown, { capture: true });
    this.host.classList.remove("ink-layer-host", "ink-layer-input-active");
    this.layer.remove();
  }

  private get settings(): InkSettings {
    return this.store.settings;
  }

  private addToolButton(tool: InkTool, icon: string, label: string): void {
    const button = this.addActionButton(icon, label, () => this.setTool(tool));
    button.dataset.tool = tool;
    button.setAttribute("aria-pressed", "false");
    this.toolButtons.set(tool, button);
  }

  private addActionButton(
    icon: string,
    label: string,
    action: (event: MouseEvent) => void
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ink-layer-tool";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action(event);
    });
    this.toolbar.appendChild(button);
    return button;
  }

  private addDivider(): void {
    const divider = document.createElement("span");
    divider.className = "ink-layer-divider";
    divider.setAttribute("aria-hidden", "true");
    this.toolbar.appendChild(divider);
  }

  private openToolOptions(event: MouseEvent): void {
    const menu = new Menu();
    if (this.tool === "pen" || this.tool === "highlighter") {
      const isPen = this.tool === "pen";
      const currentColor = isPen ? this.settings.penColor : this.settings.highlighterColor;
      const colors = isPen
        ? [
            ["Match theme", "adaptive"],
            ["Black", "#111827"],
            ["Red", "#dc2626"],
            ["Blue", "#2563eb"],
            ["Green", "#16a34a"],
            ["Purple", "#9333ea"]
          ]
        : [
            ["Yellow", "#facc15"],
            ["Green", "#4ade80"],
            ["Blue", "#60a5fa"],
            ["Pink", "#f472b6"],
            ["Orange", "#fb923c"]
          ];
      for (const [label, color] of colors) {
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setIcon("circle")
            .setChecked(currentColor.toLowerCase() === color.toLowerCase())
            .onClick(() => this.applyToolSetting(isPen ? { penColor: color } : { highlighterColor: color }))
        );
      }
      menu.addSeparator();
      const currentWidth = isPen ? this.settings.penWidth : this.settings.highlighterWidth;
      const widths: Array<[string, number]> = isPen
        ? [["Fine", 1.8], ["Medium", 3.2], ["Broad", 5.5]]
        : [["Narrow", 10], ["Medium", 18], ["Wide", 28]];
      for (const [label, width] of widths) {
        menu.addItem((item) =>
          item
            .setTitle(`${label} · ${width}px`)
            .setIcon("minus")
            .setChecked(Math.abs(currentWidth - width) < 0.01)
            .onClick(() => this.applyToolSetting(isPen ? { penWidth: width } : { highlighterWidth: width }))
        );
      }
    } else if (this.tool === "eraser") {
      for (const [label, width] of [["Small", 12], ["Medium", 20], ["Large", 36]] as Array<[string, number]>) {
        menu.addItem((item) =>
          item
            .setTitle(`${label} · ${width}px`)
            .setIcon("circle-dashed")
            .setChecked(Math.abs(this.settings.eraserWidth - width) < 0.01)
            .onClick(() => this.applyToolSetting({ eraserWidth: width }))
        );
      }
    }
    menu.showAtMouseEvent(event);
  }

  private applyToolSetting(patch: Partial<InkSettings>): void {
    this.store.updateSettings(patch);
    this.refreshSettings();
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    if (!this.active || this.isToolbarEvent(event)) return;

    if (this.shouldRejectPalm(event)) {
      consumeEvent(event);
      return;
    }
    if (!this.canDrawWith(event) || this.activePointerId !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    consumeEvent(event);
    this.activePointerId = event.pointerId;
    this.activePointerType = event.pointerType;
    this.gestureBefore = cloneStrokes(this.document.strokes);
    this.gestureChanged = false;
    try {
      this.host.setPointerCapture(event.pointerId);
    } catch {
      // Some iOS WebViews capture implicitly and reject an explicit capture.
    }

    const point = this.toDocumentPoint(event);
    const gestureTool = isEraserButton(event) ? "eraser" : this.tool;
    if (gestureTool === "pen" || gestureTool === "highlighter") {
      this.gestureMode = "draw";
      this.selectedIds.clear();
      const settings = this.settings;
      this.draft = createStroke(
        gestureTool,
        gestureTool === "pen" ? settings.penColor : settings.highlighterColor,
        gestureTool === "pen" ? settings.penWidth : settings.highlighterWidth,
        gestureTool === "pen" ? 1 : 0.34,
        [this.eventToInkPoint(event)]
      );
    } else if (gestureTool === "eraser") {
      this.gestureMode = "erase";
      this.selectedIds.clear();
      this.eraserPoint = point;
      this.eraseAt(point);
    } else {
      const bounds = combinedBounds(
        this.document.strokes.filter((stroke) => this.selectedIds.has(stroke.id))
      );
      if (bounds && pointInBounds(point, bounds, 12)) {
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
    if (!this.active || this.isToolbarEvent(event)) return;

    if (this.shouldRejectPalm(event)) {
      consumeEvent(event);
      return;
    }

    if (this.activePointerId !== event.pointerId) {
      if (this.tool === "eraser" && this.canDrawWith(event)) {
        this.eraserPoint = this.toDocumentPoint(event);
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
        const point = this.toDocumentPoint(sample);
        this.eraserPoint = point;
        this.eraseAt(point);
      }
    } else if (this.gestureMode === "lasso") {
      for (const sample of events) this.appendLassoPoint(this.toDocumentPoint(sample));
    } else if (this.gestureMode === "move-selection") {
      const point = this.toDocumentPoint(event);
      if (this.dragPrevious) {
        const dx = point.x - this.dragPrevious.x;
        const dy = point.y - this.dragPrevious.y;
        if (dx !== 0 || dy !== 0) {
          translateStrokes(this.document.strokes, this.selectedIds, dx, dy);
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
    if (this.activePointerId !== event.pointerId) return;
    consumeEvent(event);

    if (this.gestureMode === "draw" && this.draft) {
      this.appendDraftPoint(this.eventToInkPoint(event));
      this.draft.points = simplifyPoints(this.draft.points);
      if (this.draft.points.length > 0) {
        this.document.strokes.push(this.draft);
        this.gestureChanged = true;
      }
    } else if (this.gestureMode === "lasso") {
      this.appendLassoPoint(this.toDocumentPoint(event));
      this.selectedIds = selectStrokesInPolygon(this.document.strokes, this.lassoPoints);
    }

    this.finishGesture();
  }

  private onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === "pen") this.lastPenSignal = Date.now();
    if (this.activePointerId === null) {
      this.eraserPoint = null;
      this.scheduleRender();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.active) return;
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
    if (event.key === "Escape") {
      consumeEvent(event);
      if (this.selectedIds.size > 0) {
        this.selectedIds.clear();
        this.updateToolbar();
        this.scheduleRender();
      } else {
        this.setActive(false);
      }
    }
  }

  private finishGesture(): void {
    const pointerId = this.activePointerId;
    if (pointerId !== null) {
      try {
        this.host.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the WebView.
      }
    }

    if (this.gestureChanged && this.gestureBefore) this.commit(this.gestureBefore);
    this.activePointerId = null;
    this.activePointerType = "";
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
    if (this.gestureBefore && this.gestureChanged) {
      this.document.strokes = cloneStrokes(this.gestureBefore);
    }
    this.activePointerId = null;
    this.activePointerType = "";
    this.gestureMode = null;
    this.gestureBefore = null;
    this.gestureChanged = false;
    this.draft = null;
    this.lassoPoints = [];
    this.dragPrevious = null;
    this.eraserPoint = null;
  }

  private appendDraftPoint(point: InkPoint): void {
    if (!this.draft) return;
    const previous = this.draft.points[this.draft.points.length - 1];
    if (previous && squaredDistance(previous, point) < 0.04) return;
    this.draft.points.push(point);
  }

  private appendLassoPoint(point: Point2D): void {
    const previous = this.lassoPoints[this.lassoPoints.length - 1];
    if (previous && squaredDistance(previous, point) < 4) return;
    this.lassoPoints.push(point);
  }

  private eraseAt(point: Point2D): void {
    const radius = this.settings.eraserWidth / 2;
    const nextStrokes = this.document.strokes.filter((stroke) => !hitTestStroke(stroke, point, radius));
    if (nextStrokes.length !== this.document.strokes.length) {
      this.document.strokes = nextStrokes;
      this.gestureChanged = true;
      this.dryLayerDirty = true;
    }
  }

  private commit(before: InkStroke[]): void {
    this.undoStack.push(cloneStrokes(before));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.saveDocument();
  }

  private saveDocument(): void {
    this.document.updatedAt = Date.now();
    this.store.putDocument(this.document);
    this.dryLayerDirty = true;
    this.callbacks.onDocumentChange(this, this.document.notePath);
    this.updateToolbar();
    this.updateVisibility();
    this.scheduleRender();
  }

  private updateToolbar(): void {
    for (const [tool, button] of this.toolButtons) {
      const selected = tool === this.tool;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    this.undoButton.disabled = this.undoStack.length === 0;
    this.redoButton.disabled = this.redoStack.length === 0;
    this.deleteButton.disabled = this.selectedIds.size === 0;
    this.paletteButton.disabled = this.tool === "lasso";
  }

  private updateVisibility(): void {
    const visible = this.active || (this.settings.showInkWhenInactive && this.document.strokes.length > 0);
    this.layer.classList.toggle("is-visible", visible);
  }

  private scheduleRender(): void {
    if (this.animationFrame !== null || this.destroyed) return;
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.render();
    });
  }

  private render(): void {
    const hostRect = this.host.getBoundingClientRect();
    if (this.renderer.resize(hostRect.width, hostRect.height)) this.dryLayerDirty = true;
    const scrollerRect = this.scroller.getBoundingClientRect();
    const offsetX = scrollerRect.left - hostRect.left;
    const offsetY = scrollerRect.top - hostRect.top;
    const state: InkRenderState = {
      scrollLeft: this.scroller.scrollLeft - offsetX,
      scrollTop: this.scroller.scrollTop - offsetY,
      selectedIds: this.selectedIds,
      lassoPoints: this.lassoPoints,
      eraserPoint: this.eraserPoint,
      eraserRadius: this.settings.eraserWidth / 2
    };
    this.renderer.render(this.document.strokes, this.draft, state, this.dryLayerDirty);
    this.dryLayerDirty = false;
  }

  private refreshScroller(): void {
    const nextScroller = this.findScroller();
    if (nextScroller === this.scroller) return;
    this.scroller.removeEventListener("scroll", this.handleScroll);
    if (this.scroller !== this.host) this.resizeObserver.unobserve(this.scroller);
    this.scroller = nextScroller;
    this.dryLayerDirty = true;
    this.scroller.addEventListener("scroll", this.handleScroll, { passive: true });
    if (this.scroller !== this.host) this.resizeObserver.observe(this.scroller);
  }

  private findScroller(): HTMLElement {
    const sourceScroller = this.host.querySelector<HTMLElement>(".markdown-source-view .cm-scroller");
    if (sourceScroller && sourceScroller.offsetParent !== null) return sourceScroller;
    const previewScroller = this.host.querySelector<HTMLElement>(".markdown-preview-view");
    if (previewScroller && previewScroller.offsetParent !== null) return previewScroller;
    return sourceScroller ?? previewScroller ?? this.host;
  }

  private toDocumentPoint(event: PointerEvent): Point2D {
    const rect = this.scroller.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + this.scroller.scrollLeft,
      y: event.clientY - rect.top + this.scroller.scrollTop
    };
  }

  private eventToInkPoint(event: PointerEvent): InkPoint {
    const point = this.toDocumentPoint(event);
    const rawPressure = event.pressure > 0 ? event.pressure : event.pointerType === "pen" ? 0.12 : 0.5;
    const sensitivity = this.settings.pressureSensitivity;
    const pressure = 0.5 + (rawPressure - 0.5) * sensitivity;
    return createInkPoint(
      point.x,
      point.y,
      pressure,
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

  private shouldRejectPalm(event: PointerEvent): boolean {
    if (event.pointerType !== "touch" || !this.settings.palmRejection) return false;
    return (
      this.activePointerType === "pen" ||
      (this.lastPenSignal > 0 && Date.now() - this.lastPenSignal < PALM_REJECTION_WINDOW_MS)
    );
  }

  private isToolbarEvent(event: Event): boolean {
    return event.target instanceof Node && this.toolbar.contains(event.target);
  }

  private eraserCursorForTool(): void {
    if (this.tool !== "eraser") this.eraserPoint = null;
  }
}

function coalescedEvents(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents !== "function") return [event];
  const events = event.getCoalescedEvents();
  if (events.length === 0) return [event];
  const last = events[events.length - 1];
  if (last.clientX !== event.clientX || last.clientY !== event.clientY) return [...events, event];
  return events;
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
