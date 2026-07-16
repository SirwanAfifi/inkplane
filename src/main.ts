import { App, MarkdownView, Modal, Notice, Plugin, Setting, TFile, type WorkspaceLeaf } from "obsidian";
import { InkController, type InkControllerCallbacks } from "./controller";
import { InkSettingTab, type InkSettingsHost } from "./settings";
import { InkStore } from "./storage";
import type { InkTool } from "./types";

export default class InkLayerPlugin
  extends Plugin
  implements InkControllerCallbacks, InkSettingsHost
{
  store!: InkStore;
  private readonly controllers = new Map<WorkspaceLeaf, InkController>();
  private inputActive = false;
  private preferredTool: InkTool = "pen";
  private changingActiveController = false;
  private ribbonIcon: HTMLElement | null = null;

  async onload(): Promise<void> {
    this.store = new InkStore(this);
    await this.store.load();

    this.ribbonIcon = this.addRibbonIcon("pen-tool", "Toggle ink mode", () => this.toggleInkMode());
    this.addSettingTab(new InkSettingTab(this.app, this));
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      this.syncControllers();
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.handleActiveLeafChange()));
      this.registerEvent(this.app.workspace.on("file-open", () => this.reloadDocuments()));
      this.registerEvent(this.app.workspace.on("layout-change", () => this.syncControllers()));
      this.registerEvent(this.app.workspace.on("resize", () => this.refreshControllers()));
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile) {
            this.store.renameDocument(oldPath, file.path);
            this.reloadDocuments();
          }
        })
      );
    });
  }

  async onunload(): Promise<void> {
    for (const controller of this.controllers.values()) controller.destroy();
    this.controllers.clear();
    await this.store.dispose();
  }

  onActiveChange(controller: InkController, active: boolean): void {
    if (this.changingActiveController) return;
    if (active) {
      this.inputActive = true;
      this.changingActiveController = true;
      for (const candidate of this.controllers.values()) {
        if (candidate !== controller) candidate.setActive(false);
      }
      this.changingActiveController = false;
    } else if (this.activeController() === controller || !this.anyControllerActive()) {
      this.inputActive = false;
    }
    this.updateRibbon();
  }

  onToolChange(_controller: InkController, tool: InkTool): void {
    this.preferredTool = tool;
  }

  onDocumentChange(source: InkController, notePath: string): void {
    for (const controller of this.controllers.values()) {
      if (controller !== source) controller.refreshDocumentFromStore(notePath);
    }
  }

  refreshControllers(): void {
    for (const controller of this.controllers.values()) controller.refreshSettings();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "toggle-ink-mode",
      name: "Toggle ink mode",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => controller.toggleActive())
    });
    this.addCommand({
      id: "select-pen",
      name: "Select pen",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => this.activateTool(controller, "pen"))
    });
    this.addCommand({
      id: "select-highlighter",
      name: "Select highlighter",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => this.activateTool(controller, "highlighter"))
    });
    this.addCommand({
      id: "select-eraser",
      name: "Select eraser",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => this.activateTool(controller, "eraser"))
    });
    this.addCommand({
      id: "select-lasso",
      name: "Select lasso",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => this.activateTool(controller, "lasso"))
    });
    this.addCommand({
      id: "toggle-pen-eraser",
      name: "Switch between pen and eraser",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => {
        this.activateTool(controller, controller.currentTool === "eraser" ? "pen" : "eraser");
      })
    });
    this.addCommand({
      id: "undo-ink",
      name: "Undo ink",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => controller.undo())
    });
    this.addCommand({
      id: "redo-ink",
      name: "Redo ink",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => controller.redo())
    });
    this.addCommand({
      id: "clear-note-ink",
      name: "Clear ink from current note",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => {
        if (controller.hasInk) new ClearInkModal(this.app, () => controller.clearAll()).open();
      })
    });
    this.addCommand({
      id: "export-note-ink-svg",
      name: "Export current ink as SVG",
      checkCallback: (checking) => this.withMarkdownController(checking, (controller) => {
        if (controller.hasInk) void this.exportSvg(controller);
      })
    });
  }

  private withMarkdownController(checking: boolean, action: (controller: InkController) => void): boolean {
    const controller = this.ensureActiveController();
    const available = controller !== null && controller.notePath.length > 0;
    if (!checking && controller && available) action(controller);
    return available;
  }

  private activateTool(controller: InkController, tool: InkTool): void {
    controller.setTool(tool);
    controller.setActive(true);
  }

  private toggleInkMode(): void {
    const controller = this.ensureActiveController();
    if (!controller || controller.notePath.length === 0) {
      new Notice("Open a Markdown note to use Ink Layer.");
      return;
    }
    controller.toggleActive();
  }

  private handleActiveLeafChange(): void {
    this.syncControllers();
    if (!this.inputActive) return;
    const active = this.ensureActiveController();
    this.changingActiveController = true;
    for (const controller of this.controllers.values()) {
      const shouldActivate = controller === active;
      if (shouldActivate) controller.setTool(this.preferredTool);
      controller.setActive(shouldActivate);
    }
    this.changingActiveController = false;
    if (!active) this.inputActive = false;
    this.updateRibbon();
  }

  private syncControllers(): void {
    const liveLeaves = new Set(this.app.workspace.getLeavesOfType("markdown"));
    for (const leaf of liveLeaves) {
      if (!(leaf.view instanceof MarkdownView) || this.controllers.has(leaf)) continue;
      this.controllers.set(leaf, new InkController(leaf.view, this.store, this));
    }
    for (const [leaf, controller] of this.controllers) {
      if (liveLeaves.has(leaf) && leaf.view instanceof MarkdownView) continue;
      controller.destroy();
      this.controllers.delete(leaf);
    }
    this.reloadDocuments();
  }

  private reloadDocuments(): void {
    for (const controller of this.controllers.values()) controller.reloadDocument();
  }

  private ensureActiveController(): InkController | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    let controller = this.controllers.get(view.leaf);
    if (!controller) {
      controller = new InkController(view, this.store, this);
      this.controllers.set(view.leaf, controller);
    }
    controller.reloadDocument();
    return controller;
  }

  private activeController(): InkController | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? this.controllers.get(view.leaf) ?? null : null;
  }

  private anyControllerActive(): boolean {
    for (const controller of this.controllers.values()) {
      if (controller.isActive) return true;
    }
    return false;
  }

  private updateRibbon(): void {
    this.ribbonIcon?.classList.toggle("is-active", this.inputActive);
    this.ribbonIcon?.setAttribute("aria-pressed", this.inputActive ? "true" : "false");
  }

  private async exportSvg(controller: InkController): Promise<void> {
    const svg = controller.exportSvg();
    const file = controller.view.file;
    if (!svg || !file) return;
    try {
      const exportPath = await this.app.fileManager.getAvailablePathForAttachment(
        `${file.basename}.ink.svg`,
        file.path
      );
      const exportedFile = await this.app.vault.create(exportPath, svg);
      new Notice(`Exported ink to ${exportedFile.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new Notice(`Could not export ink: ${message}`);
    }
  }
}

class ClearInkModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.textContent = "Clear ink from this note?";
    const description = document.createElement("p");
    description.textContent = "This removes every ink stroke from the current note. You can undo it while the note remains open.";
    this.contentEl.appendChild(description);
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Clear ink")
          .setWarning()
          .onClick(() => {
            this.onConfirm();
            this.close();
          })
      );
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
