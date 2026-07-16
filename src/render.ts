import { getStroke } from "perfect-freehand";
import { combinedBounds } from "./model";
import type { Bounds, InkPoint, InkStroke, Point2D } from "./types";

export interface InkRenderState {
  scale: number;
  offsetX: number;
  offsetY: number;
  selectedIds: Set<string>;
  lassoPoints: Point2D[];
  eraserPoint: Point2D | null;
  eraserRadius: number;
}

export class InkRenderer {
  private readonly dryContext: CanvasRenderingContext2D;
  private readonly wetContext: CanvasRenderingContext2D;
  private cssWidth = 0;
  private cssHeight = 0;
  private pixelRatio = 1;

  constructor(
    private readonly dryCanvas: HTMLCanvasElement,
    private readonly wetCanvas: HTMLCanvasElement,
    private readonly themeElement: HTMLElement
  ) {
    const dryContext = dryCanvas.getContext("2d");
    const wetContext = wetCanvas.getContext("2d");
    if (!dryContext || !wetContext) throw new Error("Inkplane requires Canvas 2D support.");
    this.dryContext = dryContext;
    this.wetContext = wetContext;
  }

  resize(width: number, height: number): boolean {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    const nextRatio = Math.min(window.devicePixelRatio || 1, 3);
    if (
      nextWidth === this.cssWidth &&
      nextHeight === this.cssHeight &&
      nextRatio === this.pixelRatio
    ) {
      return false;
    }

    this.cssWidth = nextWidth;
    this.cssHeight = nextHeight;
    this.pixelRatio = nextRatio;
    this.dryCanvas.width = Math.ceil(nextWidth * nextRatio);
    this.dryCanvas.height = Math.ceil(nextHeight * nextRatio);
    this.wetCanvas.width = Math.ceil(nextWidth * nextRatio);
    this.wetCanvas.height = Math.ceil(nextHeight * nextRatio);
    return true;
  }

  render(
    strokes: InkStroke[],
    draft: InkStroke | null,
    state: InkRenderState,
    redrawDryLayer: boolean
  ): void {
    if (redrawDryLayer) {
      this.prepareContext(this.dryContext, state);
      for (const stroke of strokes) this.drawStroke(this.dryContext, stroke);
      this.dryContext.restore();
    }

    this.prepareContext(this.wetContext, state);
    if (draft) this.drawStroke(this.wetContext, draft);
    this.drawSelection(this.wetContext, strokes, state.selectedIds);
    this.drawLasso(this.wetContext, state.lassoPoints);
    if (state.eraserPoint) {
      this.drawEraser(this.wetContext, state.eraserPoint, state.eraserRadius);
    }
    this.wetContext.restore();
  }

  private prepareContext(
    context: CanvasRenderingContext2D,
    state: InkRenderState
  ): void {
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    context.save();
    context.translate(state.offsetX, state.offsetY);
    context.scale(state.scale, state.scale);
  }

  private drawStroke(context: CanvasRenderingContext2D, stroke: InkStroke): void {
    if (stroke.points.length === 0) return;
    const color = resolveInkColor(stroke.color, this.themeElement);
    const freehandPoints = stroke.points.map((point) => [
      point.x,
      point.y,
      normalizedPressure(point)
    ] as [number, number, number]);
    const outline = getStroke(freehandPoints, {
      size: stroke.width,
      thinning: stroke.tool === "pen" ? 0.68 : 0,
      smoothing: stroke.tool === "pen" ? 0.62 : 0.72,
      streamline: stroke.tool === "pen" ? 0.38 : 0.5,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 }
    });
    if (outline.length === 0) return;

    context.save();
    context.globalAlpha = stroke.opacity;
    context.fillStyle = color;
    context.fill(new Path2D(svgPathFromOutline(outline)));
    context.restore();
  }

  private drawSelection(
    context: CanvasRenderingContext2D,
    strokes: InkStroke[],
    selectedIds: Set<string>
  ): void {
    if (selectedIds.size === 0) return;
    const selectedStrokes = strokes.filter((stroke) => selectedIds.has(stroke.id));
    const bounds = combinedBounds(selectedStrokes);
    if (!bounds) return;
    this.drawDashedBounds(context, bounds);
  }

  private drawLasso(context: CanvasRenderingContext2D, points: Point2D[]): void {
    if (points.length < 2) return;
    context.save();
    context.strokeStyle = resolveThemeColor("--interactive-accent", this.themeElement, "#7c3aed");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
    context.restore();
  }

  private drawDashedBounds(context: CanvasRenderingContext2D, bounds: Bounds): void {
    context.save();
    context.strokeStyle = resolveThemeColor("--interactive-accent", this.themeElement, "#7c3aed");
    context.fillStyle = resolveThemeColor("--interactive-accent", this.themeElement, "#7c3aed");
    context.globalAlpha = 0.9;
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      bounds.minX - 5,
      bounds.minY - 5,
      bounds.maxX - bounds.minX + 10,
      bounds.maxY - bounds.minY + 10
    );
    context.restore();
  }

  private drawEraser(context: CanvasRenderingContext2D, point: Point2D, radius: number): void {
    context.save();
    context.strokeStyle = resolveThemeColor("--text-muted", this.themeElement, "#64748b");
    context.fillStyle = resolveThemeColor("--background-primary", this.themeElement, "#ffffff");
    context.globalAlpha = 0.82;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }
}

export function resolveInkColor(color: string, element: HTMLElement): string {
  if (color === "adaptive") {
    return resolveThemeColor("--text-normal", element, "#1f2937");
  }
  return color;
}

export function exportStrokesToSvg(strokes: InkStroke[], themeElement: HTMLElement): string | null {
  const bounds = combinedBounds(strokes);
  if (!bounds) return null;
  const padding = 12;
  const minX = Math.floor(bounds.minX - padding);
  const minY = Math.floor(bounds.minY - padding);
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + padding * 2));
  const paths = strokes.flatMap((stroke) => {
    if (stroke.points.length === 0) return [];
    const outline = getStroke(
      stroke.points.map((point) => [point.x, point.y, normalizedPressure(point)] as [number, number, number]),
      {
        size: stroke.width,
        thinning: stroke.tool === "pen" ? 0.68 : 0,
        smoothing: stroke.tool === "pen" ? 0.62 : 0.72,
        streamline: stroke.tool === "pen" ? 0.38 : 0.5,
        simulatePressure: false,
        start: { cap: true, taper: 0 },
        end: { cap: true, taper: 0 }
      }
    );
    if (outline.length === 0) return [];
    const color = escapeXml(resolveInkColor(stroke.color, themeElement));
    const path = escapeXml(svgPathFromOutline(outline));
    return [`  <path d="${path}" fill="${color}" fill-opacity="${stroke.opacity.toFixed(3)}"/>`];
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`,
    ...paths,
    "</svg>"
  ].join("\n");
}

export function svgPathFromOutline(points: number[][]): string {
  if (points.length === 0) return "";
  const first = points[0];
  if (points.length === 1) {
    return `M ${first[0]} ${first[1]} Z`;
  }

  let path = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} Q`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midX = (point[0] + next[0]) / 2;
    const midY = (point[1] + next[1]) / 2;
    path += ` ${point[0].toFixed(2)} ${point[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  return `${path} ${last[0].toFixed(2)} ${last[1].toFixed(2)} Z`;
}

function normalizedPressure(point: InkPoint): number {
  if (point.pressure <= 0) return 0.12;
  return Math.max(0.05, Math.min(1, point.pressure));
}

function resolveThemeColor(variable: string, element: HTMLElement, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value || fallback;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
