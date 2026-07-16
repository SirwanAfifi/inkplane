import { cloneStrokes, createInkPoint } from "./model";
import type { InkDrawing, InkStroke } from "./types";

const MIN_CANVAS_SIZE = 320;
const MAX_CANVAS_SIZE = 12000;

export function emptyDrawing(width = 1600, height = 1200): InkDrawing {
  return {
    version: 1,
    width: clampCanvasSize(width, 1600),
    height: clampCanvasSize(height, 1200),
    background: "paper",
    strokes: [],
    updatedAt: Date.now()
  };
}

export function cloneDrawing(drawing: InkDrawing): InkDrawing {
  return {
    ...drawing,
    strokes: cloneStrokes(drawing.strokes)
  };
}

export function parseDrawingFile(data: string): InkDrawing {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return emptyDrawing();
  }
  if (!isRecord(value)) return emptyDrawing();

  return {
    version: 1,
    width: clampCanvasSize(value.width, 1600),
    height: clampCanvasSize(value.height, 1200),
    background: "paper",
    strokes: parseStrokes(value.strokes),
    updatedAt: isFiniteNumber(value.updatedAt) ? Math.max(0, value.updatedAt) : Date.now()
  };
}

export function serializeDrawingFile(drawing: InkDrawing): string {
  return `${JSON.stringify({
    version: 1,
    width: clampCanvasSize(drawing.width, 1600),
    height: clampCanvasSize(drawing.height, 1200),
    background: "paper",
    updatedAt: Math.round(drawing.updatedAt),
    strokes: drawing.strokes.map((stroke) => ({
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color,
      width: round(stroke.width, 2),
      opacity: round(stroke.opacity, 3),
      points: stroke.points.map((point) => [
        round(point.x, 2),
        round(point.y, 2),
        round(point.pressure, 3),
        round(point.tiltX, 1),
        round(point.tiltY, 1),
        Math.round(point.time)
      ])
    }))
  }, null, 2)}\n`;
}

function parseStrokes(value: unknown): InkStroke[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawStroke, index) => {
    if (!isRecord(rawStroke) || !Array.isArray(rawStroke.points)) return [];
    const tool = rawStroke.tool === "highlighter" ? "highlighter" : rawStroke.tool === "pen" ? "pen" : null;
    if (!tool) return [];
    const points = rawStroke.points.flatMap((rawPoint) => {
      const point = parsePoint(rawPoint);
      return point ? [point] : [];
    });
    if (points.length === 0) return [];
    return [{
      id: typeof rawStroke.id === "string" && rawStroke.id.length > 0
        ? rawStroke.id
        : `recovered-${index}`,
      tool,
      color: typeof rawStroke.color === "string" ? rawStroke.color : "adaptive",
      width: numberInRange(rawStroke.width, 3.2, 0.5, 80),
      opacity: numberInRange(rawStroke.opacity, 1, 0.05, 1),
      points
    }];
  });
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

function clampCanvasSize(value: unknown, fallback: number): number {
  return Math.round(numberInRange(value, fallback, MIN_CANVAS_SIZE, MAX_CANVAS_SIZE));
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, decimalPlaces: number): number {
  const multiplier = 10 ** decimalPlaces;
  return Math.round(value * multiplier) / multiplier;
}
