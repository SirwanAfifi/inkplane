import { normalizePath, TFile, TFolder, type App } from "obsidian";
import { emptyDrawing, serializeDrawingFile } from "./file-format";
import type { InkDrawing, InkSettings } from "./types";

export const INK_EXTENSION = "inklayer";

export class DrawingRepository {
  constructor(private readonly app: App, private readonly getSettings: () => InkSettings) {}

  async create(title = "Untitled drawing", drawing?: InkDrawing): Promise<TFile> {
    const settings = this.getSettings();
    const folder = normalizePath(settings.drawingFolder.trim());
    if (folder.length > 0 && folder !== "/") await this.ensureFolder(folder);
    const baseName = sanitizeFileName(title) || "Untitled drawing";
    const path = this.availablePath(folder, baseName);
    const initial = drawing ?? emptyDrawing(settings.defaultCanvasWidth, settings.defaultCanvasHeight);
    return this.app.vault.create(path, serializeDrawingFile(initial));
  }

  drawingFiles(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => file.extension.toLowerCase() === INK_EXTENSION)
      .sort((first, second) => first.path.localeCompare(second.path));
  }

  resolve(linkPath: string, sourcePath: string): TFile | null {
    const withoutSubpath = linkPath.split("#", 1)[0].trim();
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(withoutSubpath));
    if (direct instanceof TFile && direct.extension.toLowerCase() === INK_EXTENSION) return direct;
    const resolved = this.app.metadataCache.getFirstLinkpathDest(withoutSubpath, sourcePath);
    return resolved?.extension.toLowerCase() === INK_EXTENSION ? resolved : null;
  }

  async open(file: TFile, newLeaf = false): Promise<void> {
    await this.app.workspace.getLeaf(newLeaf ? "tab" : false).openFile(file);
  }

  private availablePath(folder: string, baseName: string): string {
    let suffix = 0;
    while (true) {
      const name = suffix === 0 ? baseName : `${baseName} ${suffix + 1}`;
      const candidate = normalizePath(`${folder.length > 0 ? `${folder}/` : ""}${name}.${INK_EXTENSION}`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
      suffix += 1;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current.length > 0 ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${current} already exists and is not a folder.`);
      await this.app.vault.createFolder(current);
    }
  }
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120);
}
