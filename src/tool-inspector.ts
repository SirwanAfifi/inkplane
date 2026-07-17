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
  icon: string;
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
    icon: "pen-tool",
    colors: PEN_COLORS,
    widths: [{ label: "Fine", value: 1.8 }, { label: "Medium", value: 3.2 }, { label: "Bold", value: 5.5 }],
    minimum: 1,
    maximum: 12,
    step: 0.2
  },
  highlighter: {
    label: "Highlighter",
    description: "Translucent marker",
    icon: "highlighter",
    colors: HIGHLIGHTER_COLORS,
    widths: [{ label: "Narrow", value: 10 }, { label: "Medium", value: 18 }, { label: "Wide", value: 28 }],
    minimum: 6,
    maximum: 40,
    step: 1
  },
  eraser: {
    label: "Eraser",
    description: "Erases only where you touch",
    icon: "eraser",
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
  private applyingPatch = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly getSettings: () => InkSettings,
    private readonly onPatch: (patch: Partial<InkSettings>) => void,
    private readonly onOpenChange?: (open: boolean) => void,
    private readonly anchor?: HTMLElement
  ) {
    this.element = parent.ownerDocument.createElement("div");
    this.element.className = "ink-tool-inspector";
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Tool settings");
    this.element.setAttribute("aria-hidden", "true");
    this.element.tabIndex = -1;
    this.parent.appendChild(this.element);
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
    this.reposition();
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
    this.reposition();
  }

  refresh(): void {
    if (!this.openState || this.applyingPatch) return;
    this.render();
    this.reposition();
  }

  reposition(): void {
    if (!this.openState || !this.anchor) return;
    const parentRect = this.parent.getBoundingClientRect();
    const anchorRect = this.anchor.getBoundingClientRect();
    const panelWidth = this.element.offsetWidth;
    if (parentRect.width <= 0 || panelWidth <= 0) return;

    const desiredCenter = anchorRect.left + anchorRect.width / 2 - parentRect.left;
    const halfWidth = panelWidth / 2;
    const minimumCenter = halfWidth + 12;
    const maximumCenter = Math.max(minimumCenter, parentRect.width - halfWidth - 12);
    const center = clamp(desiredCenter, minimumCenter, maximumCenter);
    const anchorInsidePanel = clamp(desiredCenter - center + halfWidth, 24, panelWidth - 24);
    this.element.style.setProperty("--ink-inspector-x", `${center}px`);
    this.element.style.setProperty("--ink-inspector-anchor-x", `${anchorInsidePanel}px`);
  }

  close(): void {
    if (!this.openState) return;
    const shouldRestoreFocus = this.element.contains(this.element.ownerDocument.activeElement);
    this.openState = false;
    this.element.classList.remove("is-open");
    this.element.setAttribute("aria-hidden", "true");
    this.onOpenChange?.(false);
    if (shouldRestoreFocus) this.anchor?.focus({ preventScroll: true });
  }

  private render(): void {
    const doc = this.element.ownerDocument;
    const activeElement = doc.activeElement;
    const shouldRestoreFocus = activeElement !== null && this.contains(activeElement);
    const focusKey = (activeElement as HTMLElement | null)?.dataset.inkFocus;
    const settings = this.getSettings();
    const design = TOOL_DESIGNS[this.tool];
    const color = toolColor(this.tool, settings);
    const width = toolWidth(this.tool, settings);
    this.element.replaceChildren();
    this.element.setAttribute("aria-label", `${design.label} settings`);

    const header = doc.createElement("div");
    header.className = "ink-inspector-header";
    const heading = doc.createElement("div");
    heading.className = "ink-inspector-heading";
    const toolIcon = doc.createElement("span");
    toolIcon.className = "ink-inspector-tool-icon";
    toolIcon.setAttribute("aria-hidden", "true");
    setIcon(toolIcon, design.icon);
    const titleWrap = doc.createElement("div");
    const title = doc.createElement("div");
    title.className = "ink-inspector-title";
    title.textContent = `${design.label} settings`;
    const description = doc.createElement("div");
    description.className = "ink-inspector-description";
    description.textContent = design.description;
    titleWrap.append(title, description);
    heading.append(toolIcon, titleWrap);
    const closeButton = doc.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ink-inspector-close clickable-icon";
    closeButton.setAttribute("aria-label", "Close color and size");
    closeButton.dataset.inkFocus = "close";
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());
    header.append(heading, closeButton);
    this.element.appendChild(header);

    const preview = doc.createElement("div");
    preview.className = `ink-stroke-preview is-${this.tool}`;
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", `${design.label} preview at ${formatWidth(width)}`);
    const previewLine = doc.createElement("div");
    previewLine.className = "ink-stroke-preview-line";
    previewLine.style.setProperty("--ink-preview-color", cssColor(color));
    previewLine.style.setProperty("--ink-preview-width", `${previewWidth(this.tool, width)}px`);
    preview.appendChild(previewLine);
    this.element.appendChild(preview);

    if (design.colors) {
      const selectedChoice = design.colors.find((choice) => colorsMatch(color, choice.value));
      const isCustomColor = color !== "adaptive" && selectedChoice === undefined;
      const colorHeader = doc.createElement("div");
      colorHeader.className = "ink-inspector-section-row is-color";
      colorHeader.appendChild(this.sectionLabel("Color"));
      const colorValue = doc.createElement("output");
      colorValue.className = "ink-color-value";
      colorValue.textContent = selectedChoice?.label ?? color.toUpperCase();
      colorHeader.appendChild(colorValue);
      this.element.appendChild(colorHeader);

      const swatches = doc.createElement("div");
      swatches.className = "ink-color-grid";
      swatches.setAttribute("role", "group");
      swatches.setAttribute("aria-label", "Color presets");
      for (const choice of design.colors) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "ink-color-swatch";
        button.classList.toggle("is-selected", colorsMatch(color, choice.value));
        button.setAttribute("aria-label", choice.label);
        button.setAttribute("title", choice.label);
        button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
        button.dataset.inkFocus = `color-${choice.value}`;
        if (choice.value === "adaptive") {
          button.classList.add("is-adaptive");
          button.textContent = "Aa";
        } else {
          button.style.setProperty("--ink-swatch-color", choice.value);
        }
        button.appendChild(this.selectionMark());
        button.addEventListener("click", () => {
          this.applyColor(choice.value);
          this.render();
        });
        swatches.appendChild(button);
      }

      const custom = doc.createElement("label");
      custom.className = "ink-custom-color";
      custom.classList.toggle("is-selected", isCustomColor);
      custom.setAttribute("title", "Custom color");
      const colorInput = doc.createElement("input");
      colorInput.type = "color";
      colorInput.setAttribute("aria-label", "Custom color");
      colorInput.dataset.inkFocus = "color-custom";
      colorInput.value = color === "adaptive" ? "#111827" : color;
      colorInput.addEventListener("input", () => {
        this.applyColor(colorInput.value);
        previewLine.style.setProperty("--ink-preview-color", colorInput.value);
        colorValue.textContent = colorInput.value.toUpperCase();
        for (const button of swatches.querySelectorAll<HTMLButtonElement>("button")) {
          button.classList.remove("is-selected");
          button.setAttribute("aria-pressed", "false");
        }
        custom.classList.add("is-selected");
      });
      const customIcon = doc.createElement("span");
      customIcon.className = "ink-custom-color-glyph";
      customIcon.setAttribute("aria-hidden", "true");
      setIcon(customIcon, "pipette");
      custom.append(colorInput, customIcon, this.selectionMark());
      swatches.appendChild(custom);
      this.element.appendChild(swatches);
    }

    const widthHeader = doc.createElement("div");
    widthHeader.className = "ink-inspector-section-row";
    widthHeader.appendChild(this.sectionLabel(this.tool === "eraser" ? "Eraser size" : "Stroke width"));
    const widthValue = doc.createElement("output");
    widthValue.className = "ink-width-value";
    widthValue.setAttribute("aria-live", "polite");
    widthValue.textContent = formatWidth(width);
    widthHeader.appendChild(widthValue);
    this.element.appendChild(widthHeader);

    const presets = doc.createElement("div");
    presets.className = "ink-width-presets";
    presets.setAttribute("role", "group");
    presets.setAttribute("aria-label", "Width presets");
    for (const choice of design.widths) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "ink-width-preset";
      button.classList.toggle("is-selected", Math.abs(width - choice.value) < 0.01);
      button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
      button.dataset.inkFocus = `width-${choice.value}`;
      button.dataset.width = String(choice.value);
      const sample = doc.createElement("span");
      sample.className = `ink-width-preset-sample is-${this.tool}`;
      sample.style.setProperty("--ink-preset-width", `${previewWidth(this.tool, choice.value)}px`);
      sample.style.setProperty("--ink-preset-color", cssColor(color));
      sample.setAttribute("aria-hidden", "true");
      const label = doc.createElement("span");
      label.textContent = choice.label;
      button.append(sample, label);
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
    range.dataset.inkFocus = "width-slider";
    range.setAttribute("aria-label", this.tool === "eraser" ? "Eraser size" : "Stroke width");
    range.setAttribute("aria-valuetext", formatWidth(width));
    updateRangeProgress(range, width, design);
    range.addEventListener("input", () => {
      const next = Number(range.value);
      this.applyWidth(next);
      widthValue.textContent = formatWidth(next);
      range.setAttribute("aria-valuetext", formatWidth(next));
      updateRangeProgress(range, next, design);
      previewLine.style.setProperty("--ink-preview-width", `${previewWidth(this.tool, next)}px`);
      preview.setAttribute("aria-label", `${design.label} preview at ${formatWidth(next)}`);
      for (const button of presets.querySelectorAll<HTMLButtonElement>("button")) {
        const selected = Math.abs(next - Number(button.dataset.width)) < 0.01;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      }
    });
    this.element.appendChild(range);
    if (shouldRestoreFocus) {
      const controls = this.element.querySelectorAll<HTMLElement>("[data-ink-focus]");
      const focusTarget = Array.from(controls).find((control) => control.dataset.inkFocus === focusKey);
      (focusTarget ?? this.element).focus({ preventScroll: true });
    }
  }

  private sectionLabel(text: string): HTMLDivElement {
    const label = this.element.ownerDocument.createElement("div");
    label.className = "ink-inspector-section-label";
    label.textContent = text;
    return label;
  }

  private selectionMark(): HTMLSpanElement {
    const mark = this.element.ownerDocument.createElement("span");
    mark.className = "ink-color-swatch-check";
    mark.setAttribute("aria-hidden", "true");
    setIcon(mark, "check");
    return mark;
  }

  private applyColor(color: string): void {
    this.applyPatch(this.tool === "pen" ? { penColor: color } : { highlighterColor: color });
  }

  private applyWidth(width: number): void {
    if (this.tool === "pen") this.applyPatch({ penWidth: width });
    else if (this.tool === "highlighter") this.applyPatch({ highlighterWidth: width });
    else this.applyPatch({ eraserWidth: width });
  }

  private applyPatch(patch: Partial<InkSettings>): void {
    this.applyingPatch = true;
    try {
      this.onPatch(patch);
    } finally {
      this.applyingPatch = false;
    }
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

function colorsMatch(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function updateRangeProgress(range: HTMLInputElement, value: number, design: ToolDesign): void {
  const progress = ((value - design.minimum) / (design.maximum - design.minimum)) * 100;
  range.style.setProperty("--ink-range-progress", `${clamp(progress, 0, 100)}%`);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function previewWidth(tool: DesignedTool, width: number): number {
  if (tool === "highlighter") return Math.min(22, Math.max(4, width * 0.7));
  if (tool === "eraser") return Math.min(26, Math.max(6, width * 0.55));
  return Math.min(12, Math.max(2, width));
}

function formatWidth(width: number): string {
  return `${Number.isInteger(width) ? width : width.toFixed(1)} px`;
}
