import {
  App,
  FuzzySuggestModal,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  Setting,
  TFile
} from "obsidian";
import { DrawingRepository, INK_EXTENSION } from "./drawing-repository";
import { InkEmbedManager } from "./embed-manager";
import { emptyDrawing } from "./file-format";
import { InkCanvasView, INK_VIEW_TYPE, type InkCanvasViewHost } from "./ink-view";
import { combinedBounds } from "./model";
import { InkSettingTab, type InkSettingsHost } from "./settings";
import { InkStore } from "./storage";
import type { InkTool } from "./types";

export default class InkLayerPlugin
  extends Plugin
  implements InkCanvasViewHost, InkSettingsHost
{
  store!: InkStore;
  private repository!: DrawingRepository;
  private embedManager!: InkEmbedManager;
  private preferredTool: InkTool = "pen";

  async onload(): Promise<void> {
    this.store = new InkStore(this);
    await this.store.load();
    this.repository = new DrawingRepository(this.app, () => this.store.settings);
    this.embedManager = new InkEmbedManager(this.app, this.repository, () => this.store.settings);

    this.registerView(INK_VIEW_TYPE, (leaf) => new InkCanvasView(leaf, this));
    this.registerExtensions([INK_EXTENSION], INK_VIEW_TYPE);
    this.registerMarkdownPostProcessor((element, context) => {
      this.embedManager.scan(element, context.sourcePath);
    });

    this.addRibbonIcon("pen-tool", "New ink drawing", () => void this.createAndOpenDrawing());
    this.addSettingTab(new InkSettingTab(this.app, this));
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      this.embedManager.start();
      this.registerEvent(this.app.workspace.on("layout-change", () => {
        this.embedManager.scan(this.app.workspace.containerEl, "");
      }));
      this.registerEvent(this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension.toLowerCase() === INK_EXTENSION) {
          this.embedManager.refresh(file);
        }
      }));
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension.toLowerCase() === INK_EXTENSION) {
          this.embedManager.scan(this.app.workspace.containerEl, "");
        }
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension.toLowerCase() === INK_EXTENSION) {
          this.embedManager.refresh(file);
        }
      }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (file.extension.toLowerCase() === INK_EXTENSION) this.embedManager.refresh();
        else this.store.renameDocument(oldPath, file.path);
      }));
    });

    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flushOpenDrawings();
    });
    this.registerDomEvent(window, "pagehide", () => void this.flushOpenDrawings());
  }

  onunload(): void {
    this.embedManager.destroy();
    void this.persistBeforeUnload();
  }

  private async persistBeforeUnload(): Promise<void> {
    await this.flushOpenDrawings();
    await this.store.dispose();
  }

  onCanvasToolChange(tool: InkTool): void {
    this.preferredTool = tool;
  }

  refreshInkUI(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(INK_VIEW_TYPE)) {
      if (leaf.view instanceof InkCanvasView) leaf.view.refreshSettings();
    }
    this.embedManager.refreshSettings();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "new-drawing",
      name: "Create new drawing",
      callback: () => void this.createAndOpenDrawing()
    });
    this.addCommand({
      id: "insert-new-drawing",
      name: "Insert new drawing in current note",
      checkCallback: (checking) => this.withMarkdownView(checking, (view) => void this.createInsertAndOpen(view))
    });
    this.addCommand({
      id: "insert-existing-drawing",
      name: "Insert existing drawing in current note",
      checkCallback: (checking) => this.withMarkdownView(checking, (view) => {
        const files = this.repository.drawingFiles();
        if (files.length === 0) {
          new Notice("No drawings found in the configured drawing folder.");
          return;
        }
        new DrawingSuggestModal(this.app, files, (file) => this.insertEmbed(view, file)).open();
      })
    });
    this.addCommand({
      id: "convert-legacy-note-ink",
      name: "Convert legacy ink from current note to a drawing",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const path = view?.file?.path ?? "";
        const available = Boolean(view && path && this.store.hasInk(path));
        if (!checking && view && available) void this.convertLegacyInk(view);
        return available;
      }
    });
    this.addCommand({
      id: "select-pen",
      name: "Select pen",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.setTool("pen"))
    });
    this.addCommand({
      id: "select-highlighter",
      name: "Select highlighter",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.setTool("highlighter"))
    });
    this.addCommand({
      id: "select-eraser",
      name: "Select eraser",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.setTool("eraser"))
    });
    this.addCommand({
      id: "select-lasso",
      name: "Select lasso",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.setTool("lasso"))
    });
    this.addCommand({
      id: "select-pan",
      name: "Select pan tool",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.setTool("pan"))
    });
    this.addCommand({
      id: "toggle-pen-eraser",
      name: "Switch between pen and eraser",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => {
        view.setTool(view.currentTool === "eraser" ? "pen" : "eraser");
      })
    });
    this.addCommand({
      id: "undo-ink",
      name: "Undo ink",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.undo())
    });
    this.addCommand({
      id: "redo-ink",
      name: "Redo ink",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.redo())
    });
    this.addCommand({
      id: "fit-drawing",
      name: "Fit drawing to view",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => view.fitToView())
    });
    this.addCommand({
      id: "clear-drawing",
      name: "Clear current drawing",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => {
        if (view.hasInk) new ClearInkModal(this.app, () => view.clearInk()).open();
      })
    });
    this.addCommand({
      id: "export-drawing-svg",
      name: "Export current drawing as SVG",
      checkCallback: (checking) => this.withCanvasView(checking, (view) => {
        if (view.hasInk) void this.exportSvg(view);
      })
    });
  }

  private withCanvasView(checking: boolean, action: (view: InkCanvasView) => void): boolean {
    const view = this.app.workspace.getActiveViewOfType(InkCanvasView);
    if (!checking && view) action(view);
    return view !== null;
  }

  private withMarkdownView(checking: boolean, action: (view: MarkdownView) => void): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const available = Boolean(view?.file);
    if (!checking && view && available) action(view);
    return available;
  }

  private async createAndOpenDrawing(): Promise<void> {
    try {
      const file = await this.repository.create(timestampedTitle());
      await this.repository.open(file);
      const view = this.app.workspace.getActiveViewOfType(InkCanvasView);
      view?.setTool(this.preferredTool);
    } catch (error) {
      this.showError("Could not create drawing", error);
    }
  }

  private async createInsertAndOpen(markdownView: MarkdownView): Promise<void> {
    try {
      const title = markdownView.file ? `${markdownView.file.basename} drawing` : timestampedTitle();
      const file = await this.repository.create(title);
      this.insertEmbed(markdownView, file);
      await this.repository.open(file, true);
      const view = this.app.workspace.getActiveViewOfType(InkCanvasView);
      view?.setTool(this.preferredTool);
    } catch (error) {
      this.showError("Could not insert drawing", error);
    }
  }

  private insertEmbed(view: MarkdownView, file: TFile): void {
    const settings = this.store.settings;
    const embed = `![[${file.path}|${settings.defaultEmbedWidth}x${settings.defaultEmbedHeight}]]`;
    view.editor.replaceSelection(embed);
    new Notice(`Inserted ${file.basename}`);
  }

  private async convertLegacyInk(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file) return;
    const legacy = this.store.getDocument(file.path);
    if (legacy.strokes.length === 0) return;
    const drawing = emptyDrawing(
      this.store.settings.defaultCanvasWidth,
      this.store.settings.defaultCanvasHeight
    );
    drawing.strokes = legacy.strokes;
    drawing.updatedAt = legacy.updatedAt;
    const bounds = combinedBounds(drawing.strokes);
    if (bounds) {
      drawing.width = Math.max(drawing.width, Math.ceil(bounds.maxX + 64));
      drawing.height = Math.max(drawing.height, Math.ceil(bounds.maxY + 64));
    }
    try {
      const drawingFile = await this.repository.create(`${file.basename} legacy ink`, drawing);
      this.insertEmbed(view, drawingFile);
      await this.repository.open(drawingFile, true);
      new Notice("Legacy ink was copied into a standalone drawing. The original backup remains in plugin data.");
    } catch (error) {
      this.showError("Could not convert legacy ink", error);
    }
  }

  private async exportSvg(view: InkCanvasView): Promise<void> {
    const svg = view.exportSvg();
    const source = view.file;
    if (!svg || !source) return;
    try {
      const path = await this.app.fileManager.getAvailablePathForAttachment(`${source.basename}.svg`, source.path);
      const exported = await this.app.vault.create(path, svg);
      new Notice(`Exported drawing to ${exported.path}`);
    } catch (error) {
      this.showError("Could not export drawing", error);
    }
  }

  private async flushOpenDrawings(): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(INK_VIEW_TYPE)) {
      if (leaf.view instanceof InkCanvasView) saves.push(leaf.view.save());
    }
    await Promise.allSettled(saves);
    await this.store.flush();
  }

  private showError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown error";
    new Notice(`${context}: ${message}`);
  }
}

class DrawingSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Choose an ink drawing…");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

class ClearInkModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.textContent = "Clear this drawing?";
    this.contentEl.createEl("p", {
      text: "This removes every stroke. You can undo it while the drawing remains open."
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.setButtonText("Clear drawing");
        if (typeof button.setDestructive === "function") {
          button.setDestructive().setCta();
        } else {
          // Preserve destructive styling on supported Obsidian versions before 1.13.0.
          button.buttonEl.addClasses(["mod-warning", "mod-cta"]);
        }
        button.onClick(() => {
          this.onConfirm();
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}

function timestampedTitle(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `Drawing ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
