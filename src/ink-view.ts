import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { DrawingSurface } from "./drawing-surface";
import { emptyDrawing, parseDrawingFile, serializeDrawingFile } from "./file-format";
import type { InkStore } from "./storage";
import type { InkDrawing, InkTool } from "./types";

export const INK_VIEW_TYPE = "ink-layer-canvas";

export interface InkCanvasViewHost {
  store: InkStore;
  onCanvasToolChange(tool: InkTool): void;
  refreshInkUI(): void;
}

export class InkCanvasView extends TextFileView {
  private readonly surface: DrawingSurface;

  constructor(leaf: WorkspaceLeaf, private readonly pluginHost: InkCanvasViewHost) {
    super(leaf);
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("ink-canvas-view-content");
    this.surface = new DrawingSurface(this.contentEl, pluginHost.store, {
      onChange: (drawing) => {
        this.data = serializeDrawingFile(drawing);
        this.requestSave();
      },
      onToolChange: (tool) => pluginHost.onCanvasToolChange(tool),
      onSettingsChange: () => pluginHost.refreshInkUI()
    }, emptyDrawing(
      pluginHost.store.settings.defaultCanvasWidth,
      pluginHost.store.settings.defaultCanvasHeight
    ));
  }

  getViewType(): string {
    return INK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Ink drawing";
  }

  getIcon(): string {
    return "pen-tool";
  }

  getViewData(): string {
    this.data = serializeDrawingFile(this.surface.getDrawing());
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    this.surface.setDrawing(parseDrawingFile(data), clear);
  }

  clear(): void {
    this.surface.setDrawing(emptyDrawing(
      this.pluginHost.store.settings.defaultCanvasWidth,
      this.pluginHost.store.settings.defaultCanvasHeight
    ));
  }

  async onClose(): Promise<void> {
    this.surface.destroy();
    await super.onClose();
  }

  get currentTool(): InkTool {
    return this.surface.currentTool;
  }

  get hasInk(): boolean {
    return this.surface.hasInk;
  }

  getDrawing(): InkDrawing {
    return this.surface.getDrawing();
  }

  setTool(tool: InkTool): void {
    this.surface.setTool(tool);
  }

  undo(): void {
    this.surface.undo();
  }

  redo(): void {
    this.surface.redo();
  }

  clearInk(): void {
    this.surface.clearAll();
  }

  fitToView(): void {
    this.surface.fitToView();
  }

  refreshSettings(): void {
    this.surface.refreshSettings();
  }

  exportSvg(): string | null {
    return this.surface.exportSvg();
  }
}
