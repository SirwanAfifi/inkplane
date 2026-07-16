import type {
  Bounds,
  InkDocument,
  InkPoint,
  InkStroke,
  Point2D,
  StrokeTool
} from "./types";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createInkPoint(
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  time: number
): InkPoint {
  return {
    x: finiteOr(x, 0),
    y: finiteOr(y, 0),
    pressure: clamp(finiteOr(pressure, 0.5), 0, 1),
    tiltX: clamp(finiteOr(tiltX, 0), -90, 90),
    tiltY: clamp(finiteOr(tiltY, 0), -90, 90),
    time: Math.max(0, finiteOr(time, 0))
  };
}

export function createStroke(
  tool: StrokeTool,
  color: string,
  width: number,
  opacity: number,
  points: InkPoint[] = []
): InkStroke {
  return {
    id: createId(),
    tool,
    color,
    width: clamp(width, 0.5, 80),
    opacity: clamp(opacity, 0.05, 1),
    points
  };
}

export function emptyDocument(notePath: string): InkDocument {
  return { version: 1, notePath, strokes: [], updatedAt: Date.now() };
}

export function cloneDocument(document: InkDocument): InkDocument {
  return {
    version: 1,
    notePath: document.notePath,
    updatedAt: document.updatedAt,
    strokes: cloneStrokes(document.strokes)
  };
}

export function cloneStrokes(strokes: InkStroke[]): InkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  }));
}

export function simplifyPoints(points: InkPoint[], tolerance = 0.35): InkPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));

  const squareTolerance = tolerance * tolerance;
  const radiallyReduced: InkPoint[] = [points[0]];
  let previous = points[0];

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (distanceSquared(point, previous) > squareTolerance) {
      radiallyReduced.push(point);
      previous = point;
    }
  }
  radiallyReduced.push(points[points.length - 1]);

  if (radiallyReduced.length <= 2) {
    return radiallyReduced.map((point) => ({ ...point }));
  }

  const markers = new Uint8Array(radiallyReduced.length);
  markers[0] = 1;
  markers[markers.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, radiallyReduced.length - 1]];

  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [first, last] = range;
    let furthestIndex = -1;
    let furthestDistance = squareTolerance;

    for (let index = first + 1; index < last; index += 1) {
      const squareDistance = distanceToSegmentSquared(
        radiallyReduced[index],
        radiallyReduced[first],
        radiallyReduced[last]
      );
      if (squareDistance > furthestDistance) {
        furthestDistance = squareDistance;
        furthestIndex = index;
      }
    }

    if (furthestIndex !== -1) {
      markers[furthestIndex] = 1;
      if (furthestIndex - first > 1) stack.push([first, furthestIndex]);
      if (last - furthestIndex > 1) stack.push([furthestIndex, last]);
    }
  }

  return radiallyReduced
    .filter((_point, index) => markers[index] === 1)
    .map((point) => ({ ...point }));
}

export function strokeBounds(stroke: InkStroke): Bounds | null {
  if (stroke.points.length === 0) return null;
  let minX = stroke.points[0].x;
  let maxX = minX;
  let minY = stroke.points[0].y;
  let maxY = minY;

  for (let index = 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const padding = stroke.width / 2;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}

export function combinedBounds(strokes: InkStroke[]): Bounds | null {
  let result: Bounds | null = null;
  for (const stroke of strokes) {
    const bounds = strokeBounds(stroke);
    if (!bounds) continue;
    if (!result) {
      result = { ...bounds };
      continue;
    }
    result.minX = Math.min(result.minX, bounds.minX);
    result.minY = Math.min(result.minY, bounds.minY);
    result.maxX = Math.max(result.maxX, bounds.maxX);
    result.maxY = Math.max(result.maxY, bounds.maxY);
  }
  return result;
}

export function pointInBounds(point: Point2D, bounds: Bounds, padding = 0): boolean {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

export function hitTestStroke(stroke: InkStroke, point: Point2D, radius: number): boolean {
  const bounds = strokeBounds(stroke);
  if (!bounds || !pointInBounds(point, bounds, radius)) return false;
  const hitRadius = radius + stroke.width / 2;
  const squareHitRadius = hitRadius * hitRadius;

  if (stroke.points.length === 1) {
    return distanceSquared(stroke.points[0], point) <= squareHitRadius;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      distanceToSegmentSquared(point, stroke.points[index - 1], stroke.points[index]) <=
      squareHitRadius
    ) {
      return true;
    }
  }
  return false;
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function selectStrokesInPolygon(strokes: InkStroke[], polygon: Point2D[]): Set<string> {
  const selected = new Set<string>();
  for (const stroke of strokes) {
    const bounds = strokeBounds(stroke);
    if (!bounds) continue;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    if (pointInPolygon(center, polygon) || stroke.points.some((point) => pointInPolygon(point, polygon))) {
      selected.add(stroke.id);
    }
  }
  return selected;
}

export function translateStrokes(strokes: InkStroke[], selectedIds: Set<string>, dx: number, dy: number): void {
  for (const stroke of strokes) {
    if (!selectedIds.has(stroke.id)) continue;
    for (const point of stroke.points) {
      point.x += dx;
      point.y += dy;
    }
  }
}

export function distanceToSegmentSquared(point: Point2D, start: Point2D, end: Point2D): number {
  let x = start.x;
  let y = start.y;
  let dx = end.x - x;
  let dy = end.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end.x;
      y = end.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point.x - x;
  dy = point.y - y;
  return dx * dx + dy * dy;
}

function distanceSquared(first: Point2D, second: Point2D): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
