# Inkplane

Inkplane adds a pressure-sensitive infinite drawing canvas to Obsidian. Each drawing is a normal `.inklayer` file in your vault. Open it as a dedicated pen-first workspace, then embed it in any Markdown note with ordinary Obsidian embed syntax.

## Installation

### BRAT

Until Inkplane is approved for the Obsidian Community directory, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable BRAT.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/SirwanAfifi/inkplane`.
4. Enable **Inkplane** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SirwanAfifi/inkplane/releases/latest).
2. Create `<vault>/.obsidian/plugins/ink-layer/`.
3. Copy the three files into that folder, reload Obsidian, and enable **Inkplane**.

## Experience

- Dedicated `.inklayer` files instead of a drawing overlay tied to Markdown layout.
- An edge-to-edge infinite canvas with pan, trackpad navigation, pinch-to-zoom, stroke-aware fit-to-view, and zoom controls.
- Pencil-first input: Apple Pencil draws while one finger pans and two fingers zoom by default.
- Pressure-sensitive smoothed strokes using coalesced pointer samples when the WebView provides them.
- Pen, translucent highlighter, whole-stroke eraser, lasso selection, move, undo, and redo.
- Read-only Markdown previews that never capture note scrolling; select the expand control or double-click to open the source canvas.
- Theme-adaptive pen color, SVG export, iPad-safe controls, and save flushing when the app moves to the background.

## Use it

Run **Inkplane: Create new drawing** or select the pen icon in the ribbon. New drawings are stored in the `Inkplane` folder by default.

From a Markdown note, run **Inkplane: Insert new drawing in current note** to create, embed, and open a canvas in one step. Use **Insert existing drawing in current note** to choose a drawing already in the vault.

The generated Markdown is ordinary Obsidian syntax:

```md
![[Inkplane/Project sketch.inklayer|800x600]]
```

Change `800x600` to control that preview’s dimensions. The defaults and the destination folder are configurable in Inkplane settings.

## Storage, migration, and privacy

Every new drawing is readable JSON inside its `.inklayer` vault file. Points are quantized into compact tuples, while strokes retain pressure and tilt data. This makes drawings follow the same Sync, backup, rename, and file-management workflow as the rest of the vault.

Ink created by version 0.1 remains untouched in the plugin’s `data.json`. Open its original note and run **Convert legacy ink from current note to a drawing** to copy those strokes into a standalone file and insert an embed. The legacy copy is deliberately retained as a backup.

Inkplane makes no network requests and has no telemetry. SVG export writes a normal attachment into the vault.

## Platform notes

Inkplane uses the web-standard `PointerEvent` pen type, pressure, tilt, pointer capture, and coalesced events. Apple Pencil double-tap and Pencil Pro squeeze are not exposed consistently to community plugins by the iPad WebView, so the plugin does not claim to intercept those private hardware gestures. The pen/eraser command can be mapped wherever Obsidian or iPadOS exposes a configurable shortcut.

## Development

```sh
npm install
npm run check
```

For development, clone the repository into `.obsidian/plugins/ink-layer`, run `npm run dev`, and reload Obsidian. A release contains `main.js`, `manifest.json`, and `styles.css`.

The runtime uses Obsidian’s mobile-safe APIs and does not import Node or Electron APIs. Issues and feature requests are tracked on [GitHub](https://github.com/SirwanAfifi/inkplane/issues).

The internal plugin ID remains `ink-layer`, and drawing files retain the `.inklayer` extension. This preserves updates, existing installations, embeds, and vault data across the rebrand.

## License

MIT
