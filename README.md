# Ink Layer

Ink Layer adds a pressure-sensitive handwriting layer to Markdown notes in Obsidian. It is designed around Apple Pencil on iPad, while still supporting other pens and an optional mouse workflow on desktop.

## Installation

### BRAT

Until Ink Layer is approved for the Obsidian Community directory, the easiest installation method is [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable BRAT.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/SirwanAfifi/ink-layer`.
4. Enable **Ink Layer** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SirwanAfifi/ink-layer/releases/latest).
2. Create `<vault>/.obsidian/plugins/ink-layer/`.
3. Copy the three files into that folder, then reload Obsidian.
4. Enable **Ink Layer** in **Settings → Community plugins**.

## Experience

- Pressure-sensitive, smoothed pen strokes using coalesced pointer samples when the WebView provides them.
- A low-latency wet/dry canvas split, so drawing a new stroke does not repaint the full note on every sample.
- A translucent highlighter, whole-stroke eraser, and lasso selection with drag-to-move and delete.
- Pencil-first input: Apple Pencil draws while a finger continues to scroll by default.
- Palm rejection while a pen is active or has just been detected in proximity.
- Undo and redo from the toolbar, command palette, or `Cmd/Ctrl+Z` while the ink layer has focus.
- Ink remains visible in Source and Reading views, split panes, and after drawing mode closes.
- Per-note persistence that follows a note when it is renamed.
- Theme-adaptive pen color and an SVG export command.
- Large, safe-area-aware controls for iPad.

## Use it

1. Open a Markdown note.
2. Select the pen icon in the ribbon, or run **Toggle ink mode** from the command palette.
3. Write with Apple Pencil. With the defaults, a finger scrolls and does not draw.
4. Choose Pen, Highlighter, Eraser, or Lasso from the floating toolbar. The palette button changes the active tool’s color and size without leaving the note.
5. Select **Done** to return the note to normal interaction. Saved ink stays visible.

The command **Switch between pen and eraser** is intended for a hardware shortcut or hotkey. Standard pen eraser/barrel-button events are recognized automatically when iPadOS reports them to the WebView.

## Storage and privacy

Ink is stored compactly in the plugin’s Obsidian-managed `data.json`, keyed by note path. No note text is changed, no network requests are made, and there is no telemetry. Obsidian Sync users should include installed community-plugin settings if they want the ink data synchronized.

The SVG export command writes a normal attachment into the vault using the configured attachment location.

## Platform notes

Ink Layer uses the web-standard `PointerEvent` pen type, normalized pressure, tilt samples, pointer capture, and coalesced events. Apple Pencil double-tap and Pencil Pro squeeze are not exposed consistently to community plugins by the iPad WebView, so the plugin does not claim to intercept those private hardware gestures. The pen/eraser command can be mapped wherever Obsidian or iPadOS exposes a configurable shortcut.

Full-note ink uses the note’s rendered scroll coordinates. Major text edits, font changes, or width changes can reflow Markdown underneath existing strokes. Export important handwriting to SVG before radically changing the note layout.

## Development

```sh
npm install
npm run check
```

For development, clone the repository into `.obsidian/plugins/ink-layer`, run `npm run dev`, and reload Obsidian. A release contains `main.js`, `manifest.json`, and `styles.css`.

The implementation is mobile-safe: it uses Obsidian’s Vault/plugin APIs and does not import Node or Electron APIs at runtime.

Issues and feature requests are tracked on [GitHub](https://github.com/SirwanAfifi/ink-layer/issues).

## References

- [Obsidian plugin API and mobile review guidance](https://docs.obsidian.md/oo/plugin)
- [Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent)
- [Coalesced pointer events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)

## License

MIT
