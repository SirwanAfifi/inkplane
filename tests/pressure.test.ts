import { describe, expect, it } from "vitest";
import { createInkPoint } from "../src/model";
import {
  applyPressureSensitivity,
  stabilizedStrokePressures,
  stabilizePointerPressure
} from "../src/pressure";

describe("Apple Pencil pressure stabilization", () => {
  it("holds the last valid pressure across zero-valued pointer samples", () => {
    expect(stabilizePointerPressure(0, 0.62)).toBe(0.62);
    expect(stabilizePointerPressure(Number.NaN, null)).toBe(0.5);
  });

  it("damps an isolated near-zero pressure spike", () => {
    const first = stabilizePointerPressure(0.6, null);
    const dropout = stabilizePointerPressure(0.01, first);
    const recovered = stabilizePointerPressure(0.61, dropout);

    expect(dropout).toBeGreaterThan(0.5);
    expect(recovered).toBeGreaterThan(dropout);
    expect(recovered).toBeLessThan(0.61);
  });

  it("keeps pressure sensitivity optional", () => {
    expect(applyPressureSensitivity(0.1, 0)).toBe(0.5);
    expect(applyPressureSensitivity(0.8, 1)).toBe(0.8);
  });

  it("repairs isolated pressure notches in existing strokes", () => {
    const pressures = [0.55, 0.54, 0.22, 0.56, 0.55];
    const points = pressures.map((pressure, index) =>
      createInkPoint(index * 10, 0, pressure, 0, 0, index)
    );
    const stabilized = stabilizedStrokePressures(points);

    expect(stabilized[2]).toBeGreaterThan(0.5);
    expect(Math.max(...stabilized) - Math.min(...stabilized)).toBeLessThan(0.03);
  });

  it("preserves a sustained pressure transition", () => {
    const points = [0.8, 0.7, 0.6, 0.5, 0.4].map((pressure, index) =>
      createInkPoint(index * 10, 0, pressure, 0, 0, index)
    );
    const stabilized = stabilizedStrokePressures(points);

    expect(stabilized[0]).toBeGreaterThan(stabilized[stabilized.length - 1]);
    for (let index = 1; index < stabilized.length; index += 1) {
      expect(stabilized[index]).toBeLessThanOrEqual(stabilized[index - 1]);
    }
  });
});
