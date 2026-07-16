import { setIcon } from "obsidian";
import type { InkSettings, InkTool } from "./types";

interface ColorChoice {
  label: string;
  value: string;
}

interface WidthChoice {
  label: string;
  value: number;
}

interface ToolDesign {
  label: string;
  description: string;
  colors?: ColorChoice[];
  widths: WidthChoice[];
  minimum: number;
  maximum: number;
  step: number;
}

const PEN_COLORS: ColorChoice[] = [
  { label: "Match theme", value: "adaptive" },
  { label: "Ink", value: "#111827" },
  { label: "White", value: "#f8fafc" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Violet", value: "#7c3aed" }
];

const HIGHLIGHTER_COLORS: ColorChoice[] = [
  { label: "Yellow", value: "#facc15" },
  { label: "Lime", value: "#a3e635" },
  { label: "Mint", value: "#4ade80" },
  { label: "Cyan", value: "#22d3ee" },
  { label: "Blue", value: "#60a5fa" },
  { label: "Violet", value: "#a78bfa" },
  { label: "Pink", value: "#f472b6" },
  { label: "Orange", value: "#fb923c" }
];

const TOOL_DESIGNS: Record<"pen" | "highlighter" | "eraser", ToolDesign> = {
  pen: {
    label: "Pen",
    description: "Pressure-sensitive ink",
    colors: PEN_COLORS,
    widths: [{ label: "Fine", value: 1.8 }, { label: "Medium", value: 3.2 }, { label: "Bold", value: 5.5 }],
    minimum: 1,
    maximum: 12,
    step: 0.2
  },
  highlighter: {
    label: "Highlighter",
    description: "Translucent marker",
    colors: HIGHLIGHTER_COLORS,
    widths: [{ label: "Narrow", value: 10 }, { label: "Medium", value: 18 }, { label: "Wide", value: 28 }],
    minimum: 6,
    maximum: 40,
    step: 1
  },
  eraser: {
    label: "Eraser",
    description: "Removes complete strokes",
    widths: [{ label: "Small", value: 12 }, { label: "Medium", value: 20 }, { label: "Large", value: 36 }],
    minimum: 8,
    maximum: 56,
    step: 2
  }
};

type DesignedTool = keyof typeof TOOL_DESIGNS;

export class ToolInspector {
  readonly element: HTMLDivElement;
  private tool: DesignedTool = "pen";
  private openState = false;

  constructor(
    parent: HTMLElement,
    private readonly getSettings: () => InkSettings,
    private readonly onPatch: (patch: Partial<InkSettings>) => void,
    private readonly onOpenChange?: (open: boolean) => void
  ) {
    this.element = parent.ownerDocument.createElement("div");
    this.element.className = "ink-tool-inspector";
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Tool color and size");
    this.element.setAttribute("aria-hidden", "true");
    this.element.tabIndex = -1;
    parent.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  contains(node: Node): boolean {
    return this.element.contains(node);
  }

  toggle(tool: InkTool): void {
    if (!isDesignedTool(tool)) {
      this.close();
      return;
    }
    if (this.openState && this.tool === tool) {
      this.close();
      return;
    }
    this.tool = tool;
    this.openState = true;
    this.render();
    this.element.classList.add("is-open");
    this.element.setAttribute("aria-hidden", "false");
    this.onOpenChange?.(true);
  }

  switchTool(tool: InkTool): void {
    if (!this.openState) return;
    if (!isDesignedTool(tool)) {
      this.close();
      return;
    }
    this.tool = tool;
    this.render();
  }

  refresh(): void {
    if (this.openState) this.render();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.classList.remove("is-open");
    this.element.setAttribute("aria-hidden", "true");
    this.onOpenChange?.(false);
  }

  private render(): void {
    const doc = this.element.ownerDocument;
    const activeElement = doc.activeElement;
    const shouldRestoreFocus = activeElement !== null && this.contains(activeElement);
    const settings = this.getSettings();
    const design = TOOL_DESIGNS[this.tool];
    const color = toolColor(this.tool, settings);
    const width = toolWidth(this.tool, settings);
    this.element.replaceChildren();

    const header = doc.createElement("div");
    header.className = "ink-inspector-header";
    const titleWrap = doc.createElement("div");
    const title = doc.createElement("div");
    title.className = "ink-inspector-title";
    title.textContent = design.label;
    const description = doc.createElement("div");
    description.className = "ink-inspector-description";
    description.textContent = design.description;
    titleWrap.append(title, description);
    const closeButton = doc.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ink-inspector-close clickable-icon";
    closeButton.setAttribute("aria-label", "Close color and size");
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());
    header.append(titleWrap, closeButton);
    this.element.appendChild(header);

    const preview = doc.createElement("div");
    preview.className = `ink-stroke-preview is-${this.tool}`;
    const previewLine = doc.createElement("div");
    previewLine.className = "ink-stroke-preview-line";
    previewLine.style.setProperty("--ink-preview-color", cssColor(color));
    previewLine.style.setProperty("--ink-preview-width", `${previewWidth(this.tool, width)}px`);
    preview.appendChild(previewLine);
    this.element.appendChild(preview);

    if (design.colors) {
      this.element.appendChild(this.sectionLabel("Color"));
      const swatches = doc.createElement("div");
      swatches.className = "ink-color-grid";
      for (const choice of design.colors) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "ink-color-swatch";
        button.classList.toggle("is-selected", color.toLowerCase() === choice.value.toLowerCase());
        button.setAttribute("aria-label", choice.label);
        button.setAttribute("title", choice.label);
        button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
        if (choice.value === "adaptive") {
          button.classList.add("is-adaptive");
          button.textContent = "Aa";
        } else {
          button.style.setProperty("--ink-swatch-color", choice.value);
        }
        button.addEventListener("click", () => {
          this.applyColor(choice.value);
          this.render();
        });
        swatches.appendChild(button);
      }

      const custom = doc.createElement("label");
      custom.className = "ink-custom-color";
      custom.setAttribute("title", "Custom color");
      const colorInput = doc.createElement("input");
      colorInput.type = "color";
      colorInput.setAttribute("aria-label", "Custom color");
      colorInput.value = color === "adaptive" ? "#111827" : color;
      colorInput.addEventListener("input", () => {
        this.applyColor(colorInput.value);
        previewLine.style.setProperty("--ink-preview-color", colorInput.value);
      });
      const customIcon = doc.createElement("span");
      customIcon.textContent = "+";
      custom.append(colorInput, customIcon);
      swatches.appendChild(custom);
      this.element.appendChild(swatches);
    }

    const widthHeader = doc.createElement("div");
    widthHeader.className = "ink-inspector-section-row";
    widthHeader.appendChild(this.sectionLabel(this.tool === "eraser" ? "Eraser size" : "Stroke width"));
    const widthValue = doc.createElement("output");
    widthValue.className = "ink-width-value";
    widthValue.textContent = formatWidth(width);
    widthHeader.appendChild(widthValue);
    this.element.appendChild(widthHeader);

    const presets = doc.createElement("div");
    presets.className = "ink-width-presets";
    for (const choice of design.widths) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "ink-width-preset";
      button.classList.toggle("is-selected", Math.abs(width - choice.value) < 0.01);
      button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
      button.textContent = choice.label;
      button.addEventListener("click", () => {
        this.applyWidth(choice.value);
        this.render();
      });
      presets.appendChild(button);
    }
    this.element.appendChild(presets);

    const range = doc.createElement("input");
    range.type = "range";
    range.className = "ink-width-slider";
    range.min = String(design.minimum);
    range.max = String(design.maximum);
    range.step = String(design.step);
    range.value = String(width);
    range.setAttribute("aria-label", this.tool === "eraser" ? "Eraser size" : "Stroke width");
    range.addEventListener("input", () => {
      const next = Number(range.value);
      this.applyWidth(next);
      widthValue.textContent = formatWidth(next);
      previewLine.style.setProperty("--ink-preview-width", `${previewWidth(this.tool, next)}px`);
      for (const button of presets.querySelectorAll<HTMLButtonElement>("button")) {
        button.classList.remove("is-selected");
        button.setAttribute("aria-pressed", "false");
      }
    });
    this.element.appendChild(range);
    if (shouldRestoreFocus) this.element.focus({ preventScroll: true });
  }

  private sectionLabel(text: string): HTMLDivElement {
    const label = this.element.ownerDocument.createElement("div");
    label.className = "ink-inspector-section-label";
    label.textContent = text;
    return label;
  }

  private applyColor(color: string): void {
    this.onPatch(this.tool === "pen" ? { penColor: color } : { highlighterColor: color });
  }

  private applyWidth(width: number): void {
    if (this.tool === "pen") this.onPatch({ penWidth: width });
    else if (this.tool === "highlighter") this.onPatch({ highlighterWidth: width });
    else this.onPatch({ eraserWidth: width });
  }
}

export function toolColor(tool: InkTool, settings: InkSettings): string {
  if (tool === "pen") return settings.penColor;
  if (tool === "highlighter") return settings.highlighterColor;
  return "adaptive";
}

export function toolWidth(tool: InkTool, settings: InkSettings): number {
  if (tool === "pen") return settings.penWidth;
  if (tool === "highlighter") return settings.highlighterWidth;
  if (tool === "eraser") return settings.eraserWidth;
  return 0;
}

function isDesignedTool(tool: InkTool): tool is DesignedTool {
  return tool === "pen" || tool === "highlighter" || tool === "eraser";
}

function cssColor(color: string): string {
  return color === "adaptive" ? "var(--text-normal)" : color;
}

function previewWidth(tool: DesignedTool, width: number): number {
  if (tool === "highlighter") return Math.min(22, Math.max(4, width * 0.7));
  if (tool === "eraser") return Math.min(26, Math.max(6, width * 0.55));
  return Math.min(12, Math.max(2, width));
}

function formatWidth(width: number): string {
  return `${Number.isInteger(width) ? width : width.toFixed(1)} px`;
}
