import { describe, expect, it } from "vitest";
import { emptyDrawing, parseDrawingFile, serializeDrawingFile } from "../src/file-format";
import { createInkPoint, createStroke } from "../src/model";

describe(".inklayer file format", () => {
  it("round-trips a standalone drawing using compact point tuples", () => {
    const drawing = emptyDrawing(1800, 900);
    drawing.updatedAt = 1234;
    drawing.strokes.push(createStroke("pen", "adaptive", 3.2, 1, [
      createInkPoint(12.345, 67.891, 0.4567, 11.22, -33.44, 98.7)
    ]));

    const serialized = serializeDrawingFile(drawing);
    const raw = JSON.parse(serialized) as { strokes: Array<{ points: number[][] }> };
    expect(raw.strokes[0].points[0]).toEqual([12.35, 67.89, 0.457, 11.2, -33.4, 99]);

    const parsed = parseDrawingFile(serialized);
    expect(parsed).toMatchObject({ version: 1, width: 1800, height: 900, updatedAt: 1234 });
    expect(parsed.strokes[0].points[0]).toEqual({
      x: 12.35,
      y: 67.89,
      pressure: 0.457,
      tiltX: 11.2,
      tiltY: -33.4,
      time: 99
    });
  });

  it("recovers safely from corrupt dimensions and stroke values", () => {
    const parsed = parseDrawingFile(JSON.stringify({
      version: 99,
      width: -10,
      height: 99999,
      strokes: [
        { tool: "pen", points: [[10, 20, 5, -120, 120, -1]], width: 999, opacity: 9 },
        { tool: "unsupported", points: [[1, 2]] },
        { tool: "pen", points: [["bad", 2]] }
      ]
    }));

    expect(parsed.width).toBe(320);
    expect(parsed.height).toBe(12000);
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0]).toMatchObject({ width: 80, opacity: 1 });
    expect(parsed.strokes[0].points[0]).toMatchObject({ pressure: 1, tiltX: -90, tiltY: 90, time: 0 });
  });

  it("opens malformed JSON as a new empty canvas instead of throwing", () => {
    const parsed = parseDrawingFile("{not-json");
    expect(parsed.strokes).toEqual([]);
    expect(parsed).toMatchObject({ width: 1600, height: 1200 });
  });

  it("repairs Safari Pencil samples stored out of chronological order", () => {
    const parsed = parseDrawingFile(JSON.stringify({
      strokes: [{
        tool: "pen",
        points: [[10, 0, 0.5, 0, 0, 10], [30, 0, 0.5, 0, 0, 30], [20, 0, 0.5, 0, 0, 20], [40, 0, 0.5, 0, 0, 40]]
      }]
    }));

    expect(parsed.strokes[0].points.map((point) => point.x)).toEqual([10, 30, 40]);
  });
});
