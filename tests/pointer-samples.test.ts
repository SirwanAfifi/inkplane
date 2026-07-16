import { describe, expect, it } from "vitest";
import { coalescedEvents } from "../src/pointer-samples";

function pointerSample(clientX: number, timeStamp: number): PointerEvent {
  return { clientX, clientY: 0, timeStamp } as PointerEvent;
}

describe("coalesced Pencil samples", () => {
  it("ignores Safari's stale parent event when a coalesced batch is present", () => {
    const parent = pointerSample(20, 20);
    Object.assign(parent, {
      getCoalescedEvents: () => [pointerSample(10, 10), pointerSample(30, 30)]
    });

    expect(coalescedEvents(parent).map((sample) => sample.clientX)).toEqual([10, 30]);
  });

  it("sorts the coalesced batch itself by timestamp", () => {
    const parent = pointerSample(20, 20);
    Object.assign(parent, {
      getCoalescedEvents: () => [pointerSample(30, 30), pointerSample(10, 10)]
    });

    expect(coalescedEvents(parent).map((sample) => sample.clientX)).toEqual([10, 30]);
  });
});
