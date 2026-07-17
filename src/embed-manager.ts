import { MarkdownView, Notice, setIcon, TFile, type App } from "obsidian";
import { DrawingRepository, INK_EXTENSION } from "./drawing-repository";
import { parseDrawingFile } from "./file-format";
import { combinedBounds } from "./model";
import { InkRenderer, type InkRenderState } from "./render";
import type { InkDrawing, InkSettings } from "./types";

const EMBED_SELECTOR = ".internal-embed[src], .internal-embed[data-src]";

export class InkEmbedManager {
  private readonly previews = new Map<HTMLElement, InkEmbedPreview>();
  private readonly observer: MutationObserver;

  constructor(
    private readonly app: App,
    private readonly repository: DrawingRepository,
    private readonly getSettings: () => InkSettings
  ) {
    this.observer = new MutationObserver((mutations) => {
      this.removeDetachedPreviews();
      for (const mutation of mutations) {
        if (mutation.target.instanceOf(HTMLElement)) {
          this.scan(mutation.target, this.sourcePathFor(mutation.target));
        }
        for (const node of mutation.addedNodes) {
          if (node.instanceOf(HTMLElement)) this.scan(node, this.sourcePathFor(node));
        }
      }
    });
  }

  start(): void {
    this.observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
    this.scan(this.app.workspace.containerEl, "");
  }

  scan(root: HTMLElement, sourcePath: string): void {
    const candidates: HTMLElement[] = [];
    if (root.matches(EMBED_SELECTOR)) candidates.push(root);
    candidates.push(...root.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
    for (const element of candidates) this.mount(element, sourcePath || this.sourcePathFor(element));
  }

  refresh(file?: TFile): void {
    for (const preview of this.previews.values()) {
      if (!file || preview.file.path === file.path) void preview.reload();
    }
  }

  refreshSettings(): void {
    for (const preview of this.previews.values()) preview.refreshSettings();
  }

  destroy(): void {
    this.observer.disconnect();
    for (const preview of this.previews.values()) preview.destroy();
    this.previews.clear();
  }

  private mount(element: HTMLElement, sourcePath: string): void {
    if (this.previews.has(element)) return;
    const linkPath = element.getAttribute("src") ?? element.getAttribute("data-src") ?? "";
    if (!isInkLink(linkPath)) return;
    const file = this.repository.resolve(linkPath, sourcePath);
    if (!file) {
      element.classList.add("ink-embed-missing");
      return;
    }
    const preview = new InkEmbedPreview(
      this.app,
      this.repository,
      element,
      file,
      this.getSettings
    );
    this.previews.set(element, preview);
    void preview.reload();
  }

  private sourcePathFor(element: HTMLElement): string {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.contentEl.contains(element)) {
        return leaf.view.file?.path ?? "";
      }
    }
    return "";
  }

  private removeDetachedPreviews(): void {
    for (const [element, preview] of this.previews) {
      if (element.isConnected && preview.isMounted()) continue;
      preview.destroy();
      this.previews.delete(element);
    }
  }
}

class InkEmbedPreview {
  private readonly shell: HTMLDivElement;
  private readonly dryCanvas: HTMLCanvasElement;
  private readonly wetCanvas: HTMLCanvasElement;
  private readonly renderer: InkRenderer;
  private readonly resizeObserver: ResizeObserver;
  private drawing: InkDrawing | null = null;
  private loadSequence = 0;
  private destroyed = false;

  constructor(
    private readonly app: App,
    private readonly repository: DrawingRepository,
    private readonly container: HTMLElement,
    readonly file: TFile,
    private readonly getSettings: () => InkSettings
  ) {
    this.shell = container.createDiv({ cls: "ink-embed-preview", attr: { tabindex: "0" } });
    this.dryCanvas = this.shell.createEl("canvas", {
      cls: "ink-embed-layer",
      attr: { "aria-hidden": "true" }
    });
    this.wetCanvas = this.shell.createEl("canvas", {
      cls: "ink-embed-layer",
      attr: { "aria-hidden": "true" }
    });

    const openButton = this.shell.createEl("button", {
      cls: "ink-embed-open clickable-icon",
      attr: { type: "button", "aria-label": `Open ${file.basename}`, title: "Open drawing" }
    });
    setIcon(openButton, "maximize-2");
    openButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.repository.open(this.file);
    });
    this.shell.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void this.repository.open(this.file);
    });

    this.container.replaceChildren(this.shell);
    this.container.classList.add("ink-layer-embed");
    this.renderer = new InkRenderer(this.dryCanvas, this.wetCanvas, this.shell);
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.shell);
    this.refreshSettings();
  }

  async reload(): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const data = await this.app.vault.cachedRead(this.file);
      if (this.destroyed || sequence !== this.loadSequence) return;
      this.drawing = parseDrawingFile(data);
      this.shell.classList.remove("is-error");
      this.render();
    } catch (error) {
      if (this.destroyed || sequence !== this.loadSequence) return;
      this.shell.classList.add("is-error");
      const message = error instanceof Error ? error.message : "Unknown error";
      this.shell.setAttribute("aria-label", `Could not render drawing: ${message}`);
      new Notice(`Could not render ${this.file.basename}: ${message}`);
    }
  }

  refreshSettings(): void {
    const dimensions = embedDimensions(this.container, this.getSettings());
    this.shell.style.setProperty("--ink-embed-width", `${dimensions.width}px`);
    this.shell.style.setProperty("--ink-embed-ratio", `${dimensions.width} / ${dimensions.height}`);
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
  }

  isMounted(): boolean {
    return this.shell.isConnected && this.container.contains(this.shell);
  }

  private render(): void {
    if (!this.drawing || this.destroyed) return;
    const rect = this.shell.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.renderer.resize(rect.width, rect.height);
    const bounds = combinedBounds(this.drawing.strokes);
    const padding = Math.min(28, Math.max(12, rect.width * 0.04));
    const width = bounds ? Math.max(1, bounds.maxX - bounds.minX) : 1;
    const height = bounds ? Math.max(1, bounds.maxY - bounds.minY) : 1;
    const scale = bounds ? Math.min(
      4,
      (rect.width - padding * 2) / width,
      (rect.height - padding * 2) / height
    ) : 1;
    const state: InkRenderState = {
      scale,
      offsetX: bounds ? (rect.width - width * scale) / 2 - bounds.minX * scale : 0,
      offsetY: bounds ? (rect.height - height * scale) / 2 - bounds.minY * scale : 0,
      selectedIds: new Set(),
      lassoPoints: [],
      eraserPoint: null,
      eraserRadius: 0
    };
    this.renderer.render(this.drawing.strokes, null, state, true);
  }
}

function isInkLink(linkPath: string): boolean {
  const normalized = linkPath.split("#", 1)[0].split("?", 1)[0].toLowerCase();
  return normalized.endsWith(`.${INK_EXTENSION}`);
}

function embedDimensions(element: HTMLElement, settings: InkSettings): { width: number; height: number } {
  const explicitWidth = parseDimension(element.getAttribute("width"));
  const explicitHeight = parseDimension(element.getAttribute("height"));
  const alias = element.getAttribute("alt") ?? "";
  const match = alias.match(/(?:^|\|)(\d{2,4})x(\d{2,4})$/i);
  const width = explicitWidth ?? (match ? Number(match[1]) : settings.defaultEmbedWidth);
  const height = explicitHeight ?? (match ? Number(match[2]) : settings.defaultEmbedHeight);
  return {
    width: Math.min(2400, Math.max(240, width)),
    height: Math.min(1800, Math.max(180, height))
  };
}

function parseDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
