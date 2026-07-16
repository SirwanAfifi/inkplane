import { cloneDocument, createInkPoint, emptyDocument } from "./model";
import { DEFAULT_SETTINGS, type InkDocument, type InkPluginData, type InkSettings, type InkStroke } from "./types";

export interface PluginDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export class InkStore {
  private data: InkPluginData = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    documents: {}
  };
  private saveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly host: PluginDataHost) {}

  async load(): Promise<void> {
    this.data = parsePluginData(await this.host.loadData());
  }

  get settings(): InkSettings {
    return this.data.settings;
  }

  updateSettings(patch: Partial<InkSettings>): void {
    this.data.settings = sanitizeSettings({ ...this.data.settings, ...patch });
    this.scheduleSave();
  }

  getDocument(notePath: string): InkDocument {
    const document = this.data.documents[notePath];
    return document ? cloneDocument(document) : emptyDocument(notePath);
  }

  putDocument(document: InkDocument): void {
    const copy = cloneDocument(document);
    copy.updatedAt = Date.now();
    this.data.documents[copy.notePath] = copy;
    this.scheduleSave();
  }

  renameDocument(oldPath: string, newPath: string): void {
    const document = this.data.documents[oldPath];
    if (!document) return;
    delete this.data.documents[oldPath];
    document.notePath = newPath;
    document.updatedAt = Date.now();
    this.data.documents[newPath] = document;
    this.scheduleSave();
  }

  hasInk(notePath: string): boolean {
    return (this.data.documents[notePath]?.strokes.length ?? 0) > 0;
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const snapshot = serializePluginData(this.data);
    this.saveChain = this.saveChain.then(() => this.host.saveData(snapshot));
    await this.saveChain;
  }

  dispose(): Promise<void> {
    return this.flush();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 350);
  }
}

function parsePluginData(value: unknown): InkPluginData {
  const fallback: InkPluginData = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    documents: {}
  };
  if (!isRecord(value)) return fallback;

  const rawDocuments = isRecord(value.documents) ? value.documents : {};
  const documents: Record<string, InkDocument> = {};
  for (const [path, rawDocument] of Object.entries(rawDocuments)) {
    const document = parseDocument(rawDocument, path);
    if (document) documents[path] = document;
  }

  return {
    version: 1,
    settings: sanitizeSettings(isRecord(value.settings) ? value.settings : {}),
    documents
  };
}

function parseDocument(value: unknown, fallbackPath: string): InkDocument | null {
  if (!isRecord(value) || !Array.isArray(value.strokes)) return null;
  const strokes: InkStroke[] = value.strokes.flatMap((rawStroke, strokeIndex) => {
    if (!isRecord(rawStroke) || !Array.isArray(rawStroke.points)) return [];
    const tool = rawStroke.tool === "highlighter" ? "highlighter" : rawStroke.tool === "pen" ? "pen" : null;
    if (!tool) return [];
    const points = rawStroke.points.flatMap((rawPoint) => {
      const point = parsePoint(rawPoint);
      return point ? [point] : [];
    });
    if (points.length === 0) return [];
    return [{
      id: typeof rawStroke.id === "string" ? rawStroke.id : `${Date.now()}-${strokeIndex}`,
      tool,
      color: typeof rawStroke.color === "string" ? rawStroke.color : "adaptive",
      width: numberInRange(rawStroke.width, 3.2, 0.5, 80),
      opacity: numberInRange(rawStroke.opacity, 1, 0.05, 1),
      points
    }];
  });

  return {
    version: 1,
    notePath: typeof value.notePath === "string" ? value.notePath : fallbackPath,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : Date.now(),
    strokes
  };
}

function sanitizeSettings(value: Record<string, unknown> | InkSettings): InkSettings {
  return {
    penColor: stringOr(value.penColor, DEFAULT_SETTINGS.penColor),
    penWidth: numberInRange(value.penWidth, DEFAULT_SETTINGS.penWidth, 1, 20),
    highlighterColor: stringOr(value.highlighterColor, DEFAULT_SETTINGS.highlighterColor),
    highlighterWidth: numberInRange(value.highlighterWidth, DEFAULT_SETTINGS.highlighterWidth, 4, 48),
    eraserWidth: numberInRange(value.eraserWidth, DEFAULT_SETTINGS.eraserWidth, 6, 64),
    pressureSensitivity: numberInRange(
      value.pressureSensitivity,
      DEFAULT_SETTINGS.pressureSensitivity,
      0,
      1
    ),
    palmRejection: booleanOr(value.palmRejection, DEFAULT_SETTINGS.palmRejection),
    allowFingerDrawing: booleanOr(value.allowFingerDrawing, DEFAULT_SETTINGS.allowFingerDrawing),
    allowMouseDrawing: booleanOr(value.allowMouseDrawing, DEFAULT_SETTINGS.allowMouseDrawing),
    toolbarPosition: value.toolbarPosition === "bottom" ? "bottom" : "top",
    drawingFolder: stringOr(value.drawingFolder, DEFAULT_SETTINGS.drawingFolder),
    defaultCanvasWidth: numberInRange(
      value.defaultCanvasWidth,
      DEFAULT_SETTINGS.defaultCanvasWidth,
      320,
      12000
    ),
    defaultCanvasHeight: numberInRange(
      value.defaultCanvasHeight,
      DEFAULT_SETTINGS.defaultCanvasHeight,
      320,
      12000
    ),
    defaultEmbedWidth: numberInRange(
      value.defaultEmbedWidth,
      DEFAULT_SETTINGS.defaultEmbedWidth,
      240,
      2400
    ),
    defaultEmbedHeight: numberInRange(
      value.defaultEmbedHeight,
      DEFAULT_SETTINGS.defaultEmbedHeight,
      180,
      1800
    )
  };
}

function serializePluginData(data: InkPluginData): unknown {
  const documents: Record<string, unknown> = {};
  for (const [path, document] of Object.entries(data.documents)) {
    documents[path] = {
      version: 1,
      notePath: document.notePath,
      updatedAt: document.updatedAt,
      strokes: document.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => [
          round(point.x, 2),
          round(point.y, 2),
          round(point.pressure, 3),
          round(point.tiltX, 1),
          round(point.tiltY, 1),
          Math.round(point.time)
        ])
      }))
    };
  }
  return {
    version: 1,
    settings: { ...data.settings },
    documents
  };
}

function parsePoint(value: unknown): ReturnType<typeof createInkPoint> | null {
  if (Array.isArray(value)) {
    if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1])) return null;
    return createInkPoint(
      value[0],
      value[1],
      isFiniteNumber(value[2]) ? value[2] : 0.5,
      isFiniteNumber(value[3]) ? value[3] : 0,
      isFiniteNumber(value[4]) ? value[4] : 0,
      isFiniteNumber(value[5]) ? value[5] : 0
    );
  }
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return createInkPoint(
    value.x,
    value.y,
    isFiniteNumber(value.pressure) ? value.pressure : 0.5,
    isFiniteNumber(value.tiltX) ? value.tiltX : 0,
    isFiniteNumber(value.tiltY) ? value.tiltY : 0,
    isFiniteNumber(value.time) ? value.time : 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimalPlaces: number): number {
  const multiplier = 10 ** decimalPlaces;
  return Math.round(value * multiplier) / multiplier;
}
