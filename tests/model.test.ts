import { describe, expect, it } from "vitest";
import {
  cloneDocument,
  createInkPoint,
  createStroke,
  emptyDocument,
  eraseStrokeAt,
  hitTestStroke,
  pointInPolygon,
  repairInkPointOrder,
  removeSharpBacktracks,
  selectStrokesInPolygon,
  simplifyPoints,
  translateStrokes
} from "../src/model";
import { pressureAdjustedWidth, svgPathFromOutline } from "../src/render";

describe("ink points", () => {
  it("sanitizes unsupported pointer values", () => {
    const point = createInkPoint(Number.NaN, 12, 4, -120, 200, -5);
    expect(point).toEqual({ x: 0, y: 12, pressure: 1, tiltX: -90, tiltY: 90, time: 0 });
  });

  it("simplifies a straight stroke without losing its endpoints", () => {
    const points = Array.from({ length: 101 }, (_value, index) =>
      createInkPoint(index, index * 2, 0.2 + index / 200, 0, 0, index)
    );
    const simplified = simplifyPoints(points, 0.25);
    expect(simplified.length).toBeLessThan(10);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
  });

  it("drops Safari parent samples that arrive behind a coalesced batch", () => {
    const first = createInkPoint(10, 0, 0.5, 0, 0, 10);
    const latest = createInkPoint(30, 0, 0.5, 0, 0, 30);
    const staleParent = createInkPoint(20, 0, 0.5, 0, 0, 20);
    const next = createInkPoint(40, 0, 0.5, 0, 0, 40);
    expect(repairInkPointOrder([first, latest, staleParent, next])).toEqual([
      first,
      latest,
      next
    ]);
  });

  it("removes only the short leg of a sharp Pencil backtrack", () => {
    const first = createInkPoint(0, 0, 0.5, 0, 0, 0);
    const forward = createInkPoint(10, 0, 0.5, 0, 0, 10);
    const staleBacktrack = createInkPoint(8, 0, 0.5, 0, 0, 20);
    const next = createInkPoint(20, 0, 0.5, 0, 0, 30);
    expect(removeSharpBacktracks([first, forward, staleBacktrack, next], 3.2)).toEqual([
      first,
      forward,
      next
    ]);
  });
});

describe("stroke editing geometry", () => {
  const horizontalStroke = createStroke("pen", "adaptive", 4, 1, [
    createInkPoint(10, 10, 0.5, 0, 0, 0),
    createInkPoint(100, 10, 0.5, 0, 0, 1)
  ]);

  it("hits a stroke using both eraser and stroke radii", () => {
    expect(hitTestStroke(horizontalStroke, { x: 50, y: 15 }, 4)).toBe(true);
    expect(hitTestStroke(horizontalStroke, { x: 50, y: 30 }, 4)).toBe(false);
  });

  it("splits a stroke around the part touched by the eraser", () => {
    const fragments = eraseStrokeAt(horizontalStroke, { x: 50, y: 10 }, 4);

    expect(fragments).toHaveLength(2);
    expect(fragments[0].points[fragments[0].points.length - 1].x).toBeCloseTo(44);
    expect(fragments[1].points[0].x).toBeCloseTo(56);
    expect(fragments.every((fragment) => fragment.color === horizontalStroke.color)).toBe(true);
    expect(fragments.every((fragment) => fragment.width === horizontalStroke.width)).toBe(true);
  });

  it("trims only the touched end of a stroke", () => {
    const fragments = eraseStrokeAt(horizontalStroke, { x: 10, y: 10 }, 4);

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).not.toBe(horizontalStroke);
    expect(fragments[0].points[0].x).toBeCloseTo(16);
    expect(fragments[0].points[fragments[0].points.length - 1].x).toBeCloseTo(100);
  });

  it("keeps an untouched stroke unchanged", () => {
    const fragments = eraseStrokeAt(horizontalStroke, { x: 50, y: 30 }, 4);

    expect(fragments).toEqual([horizontalStroke]);
    expect(fragments[0]).toBe(horizontalStroke);
  });

  it("selects strokes enclosed by a lasso", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 30 },
      { x: 0, y: 30 }
    ];
    expect(pointInPolygon({ x: 50, y: 10 }, polygon)).toBe(true);
    expect(selectStrokesInPolygon([horizontalStroke], polygon)).toEqual(new Set([horizontalStroke.id]));
  });

  it("moves only selected strokes", () => {
    const other = createStroke("highlighter", "#ffff00", 18, 0.34, [
      createInkPoint(5, 50, 0.5, 0, 0, 0)
    ]);
    const strokes = [horizontalStroke, other];
    translateStrokes(strokes, new Set([horizontalStroke.id]), 8, -3);
    expect(horizontalStroke.points[0]).toMatchObject({ x: 18, y: 7 });
    expect(other.points[0]).toMatchObject({ x: 5, y: 50 });
  });
});

describe("document safety", () => {
  it("deep-clones strokes before history or persistence writes", () => {
    const document = emptyDocument("Notes/Test.md");
    document.strokes.push(createStroke("pen", "adaptive", 3, 1, [createInkPoint(1, 2, 0.5, 0, 0, 0)]));
    const clone = cloneDocument(document);
    clone.strokes[0].points[0].x = 99;
    expect(document.strokes[0].points[0].x).toBe(1);
  });

  it("creates a closed SVG path from a freehand outline", () => {
    const path = svgPathFromOutline([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(path).toBe(
      "M 0.00 5.00 Q 0.00 0.00 5.00 0.00 Q 10.00 0.00 10.00 5.00 Q 10.00 10.00 5.00 10.00 Q 0.00 10.00 0.00 5.00 Z"
    );
  });

  it("maps Pencil pressure to a stable positive stroke width", () => {
    expect(pressureAdjustedWidth(4, 0.5)).toBe(4);
    expect(pressureAdjustedWidth(4, 0.2)).toBeLessThan(4);
    expect(pressureAdjustedWidth(4, 0)).toBeGreaterThan(0);
  });
});
