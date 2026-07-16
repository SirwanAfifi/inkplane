import { afterEach, describe, expect, it, vi } from "vitest";
import { createInkPoint, createStroke } from "../src/model";
import { InkStore, type PluginDataHost } from "../src/storage";

afterEach(() => vi.unstubAllGlobals());

describe("InkStore", () => {
  it("loads compact point tuples and sanitizes persisted values", async () => {
    const host: PluginDataHost = {
      loadData: async () => ({
        version: 1,
        settings: { penWidth: 999, palmRejection: false },
        documents: {
          "Notes/Test.md": {
            version: 1,
            notePath: "Notes/Test.md",
            updatedAt: 10,
            strokes: [{
              id: "stroke-1",
              tool: "pen",
              color: "adaptive",
              width: 500,
              opacity: 2,
              points: [[1, 2, 4, -100, 100, -1]]
            }]
          }
        }
      }),
      saveData: async () => undefined
    };
    const store = new InkStore(host);
    await store.load();

    expect(store.settings.penWidth).toBe(20);
    expect(store.settings.palmRejection).toBe(false);
    expect(store.getDocument("Notes/Test.md").strokes[0]).toMatchObject({ width: 80, opacity: 1 });
    expect(store.getDocument("Notes/Test.md").strokes[0].points[0]).toEqual({
      x: 1,
      y: 2,
      pressure: 1,
      tiltX: -90,
      tiltY: 90,
      time: 0
    });
  });

  it("writes points as compact, quantized tuples", async () => {
    vi.stubGlobal("window", globalThis);
    let saved: unknown;
    const host: PluginDataHost = {
      loadData: async () => null,
      saveData: async (data) => {
        saved = data;
      }
    };
    const store = new InkStore(host);
    await store.load();
    const document = store.getDocument("Notes/Test.md");
    document.strokes.push(createStroke("pen", "adaptive", 3.2, 1, [
      createInkPoint(1.2345, 9.8765, 0.45678, 12.34, -56.78, 99.6)
    ]));
    store.putDocument(document);
    await store.flush();

    const data = saved as {
      documents: Record<string, { strokes: Array<{ points: number[][] }> }>;
    };
    expect(data.documents["Notes/Test.md"].strokes[0].points[0]).toEqual([
      1.23,
      9.88,
      0.457,
      12.3,
      -56.8,
      100
    ]);
  });
});
