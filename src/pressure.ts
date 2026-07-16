import type { InkPoint } from "./types";

const DEFAULT_PRESSURE = 0.5;
const MIN_PRESSURE = 0.05;
const MAX_DOWNWARD_STEP = 0.18;

export function stabilizePointerPressure(
  rawPressure: number,
  previousPressure: number | null
): number {
  const fallback = previousPressure ?? DEFAULT_PRESSURE;
  if (!Number.isFinite(rawPressure) || rawPressure <= 0) return fallback;

  const target = clamp(rawPressure, MIN_PRESSURE, 1);
  if (previousPressure === null) return target;

  const boundedTarget = Math.max(target, previousPressure - MAX_DOWNWARD_STEP);
  const response = boundedTarget < previousPressure ? 0.32 : 0.48;
  return clamp(
    previousPressure + (boundedTarget - previousPressure) * response,
    MIN_PRESSURE,
    1
  );
}

export function applyPressureSensitivity(pressure: number, sensitivity: number): number {
  const normalizedPressure = clamp(
    Number.isFinite(pressure) ? pressure : DEFAULT_PRESSURE,
    MIN_PRESSURE,
    1
  );
  const normalizedSensitivity = clamp(Number.isFinite(sensitivity) ? sensitivity : 1, 0, 1);
  return clamp(
    DEFAULT_PRESSURE + (normalizedPressure - DEFAULT_PRESSURE) * normalizedSensitivity,
    MIN_PRESSURE,
    1
  );
}

export function stabilizedStrokePressures(points: InkPoint[]): number[] {
  const pressures = points.map((point) => normalizedPressure(point.pressure));
  if (pressures.length < 3) return pressures;

  const despiked = pressures.map((pressure, index) => {
    if (index === 0 || index === pressures.length - 1) return pressure;
    return median(pressures[index - 1], pressure, pressures[index + 1]);
  });

  const forward = [...despiked];
  for (let index = 1; index < forward.length; index += 1) {
    forward[index] = forward[index] * 0.65 + forward[index - 1] * 0.35;
  }

  const smoothed = [...forward];
  for (let index = smoothed.length - 2; index >= 0; index -= 1) {
    smoothed[index] = smoothed[index] * 0.65 + smoothed[index + 1] * 0.35;
  }
  return smoothed;
}

function normalizedPressure(pressure: number): number {
  if (!Number.isFinite(pressure) || pressure <= 0) return DEFAULT_PRESSURE;
  return clamp(pressure, MIN_PRESSURE, 1);
}

function median(first: number, second: number, third: number): number {
  return first + second + third - Math.min(first, second, third) - Math.max(first, second, third);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
