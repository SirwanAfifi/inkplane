# Changelog

All notable changes to Inkplane are documented here.

## 0.2.1 — 2026-07-17

- Addressed Obsidian review recommendations across source code and styles.
- Scoped drawing discovery to the configured Inkplane folder instead of enumerating the vault.
- Added searchable settings for Obsidian 1.13 while preserving compatibility with older supported releases.
- Added GitHub artifact attestations for release assets.
- Updated the README with the latest installation guidance, privacy details, and product imagery.

## 0.2.0 — 2026-07-16

- Rebranded Ink Layer as Inkplane to reflect the new standalone infinite-canvas experience.
- Stabilized Apple Pencil pressure samples to prevent segmented, pinched strokes in iPad WebViews.
- Rebuilt the iPad toolbar as a compact touch palette with reliable icons and safe-area positioning.
- Fixed malformed quadratic outline closure that produced triangular cuts inside Pencil strokes on WebKit.
- Replaced Markdown note overlays with standalone `.inklayer` drawing files.
- Added a dedicated edge-to-edge infinite canvas with Pencil drawing, one-finger pan, pinch zoom, trackpad navigation, and stroke-aware fit controls.
- Added read-only Markdown embeds with configurable dimensions and an open-source drawing control.
- Added commands to create, insert, choose, export, and clear drawings.
- Added a safe legacy conversion command; version 0.1 overlay data remains intact as a backup.
- Added background-save flushing and standalone file-format recovery tests.

## 0.1.0 — 2026-07-16

- Initial public release.
- Added pressure-sensitive pen and translucent highlighter tools.
- Added palm rejection, finger scrolling, stroke erasing, and lasso selection.
- Added undo, redo, color and size controls, theme-aware rendering, and SVG export.
- Added per-note persistence across Source and Reading views, split panes, and note renames.
