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
    this.element = parent.createDiv({
      cls: "ink-tool-inspector",
      attr: {
        role: "dialog",
        "aria-label": "Tool settings",
        "aria-hidden": "true",
        tabindex: "-1"
      }
    });
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

    const header = this.element.createDiv({ cls: "ink-inspector-header" });
    const heading = header.createDiv({ cls: "ink-inspector-heading" });
    const toolIcon = heading.createSpan({
      cls: "ink-inspector-tool-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(toolIcon, design.icon);
    const titleWrap = heading.createDiv();
    titleWrap.createDiv({ cls: "ink-inspector-title", text: `${design.label} settings` });
    titleWrap.createDiv({ cls: "ink-inspector-description", text: design.description });
    const closeButton = header.createEl("button", {
      cls: "ink-inspector-close clickable-icon",
      attr: { type: "button", "aria-label": "Close color and size" }
    });
    closeButton.dataset.inkFocus = "close";
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());

    const preview = this.element.createDiv({
      cls: `ink-stroke-preview is-${this.tool}`,
      attr: { role: "img", "aria-label": `${design.label} preview at ${formatWidth(width)}` }
    });
    const previewLine = preview.createDiv({ cls: "ink-stroke-preview-line" });
    previewLine.style.setProperty("--ink-preview-color", cssColor(color));
    previewLine.style.setProperty("--ink-preview-width", `${previewWidth(this.tool, width)}px`);

    if (design.colors) {
      const selectedChoice = design.colors.find((choice) => colorsMatch(color, choice.value));
      const isCustomColor = color !== "adaptive" && selectedChoice === undefined;
      const colorHeader = this.element.createDiv({ cls: "ink-inspector-section-row is-color" });
      this.sectionLabel(colorHeader, "Color");
      const colorValue = colorHeader.createEl("output", {
        cls: "ink-color-value",
        text: selectedChoice?.label ?? color.toUpperCase()
      });

      const swatches = this.element.createDiv({
        cls: "ink-color-grid",
        attr: { role: "group", "aria-label": "Color presets" }
      });
      for (const choice of design.colors) {
        const button = swatches.createEl("button", {
          cls: "ink-color-swatch",
          attr: { type: "button", "aria-label": choice.label, title: choice.label }
        });
        button.classList.toggle("is-selected", colorsMatch(color, choice.value));
        button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
        button.dataset.inkFocus = `color-${choice.value}`;
        if (choice.value === "adaptive") {
          button.classList.add("is-adaptive");
          button.textContent = "Aa";
        } else {
          button.style.setProperty("--ink-swatch-color", choice.value);
        }
        this.selectionMark(button);
        button.addEventListener("click", () => {
          this.applyColor(choice.value);
          this.render();
        });
      }

      const custom = swatches.createEl("label", { cls: "ink-custom-color", attr: { title: "Custom color" } });
      custom.classList.toggle("is-selected", isCustomColor);
      const colorInput = custom.createEl("input", {
        attr: { type: "color", "aria-label": "Custom color" }
      });
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
      const customIcon = custom.createSpan({
        cls: "ink-custom-color-glyph",
        attr: { "aria-hidden": "true" }
      });
      setIcon(customIcon, "pipette");
      this.selectionMark(custom);
    }

    const widthHeader = this.element.createDiv({ cls: "ink-inspector-section-row" });
    this.sectionLabel(widthHeader, this.tool === "eraser" ? "Eraser size" : "Stroke width");
    const widthValue = widthHeader.createEl("output", {
      cls: "ink-width-value",
      text: formatWidth(width),
      attr: { "aria-live": "polite" }
    });

    const presets = this.element.createDiv({
      cls: "ink-width-presets",
      attr: { role: "group", "aria-label": "Width presets" }
    });
    for (const choice of design.widths) {
      const button = presets.createEl("button", {
        cls: "ink-width-preset",
        attr: { type: "button" }
      });
      button.classList.toggle("is-selected", Math.abs(width - choice.value) < 0.01);
      button.setAttribute("aria-pressed", button.classList.contains("is-selected") ? "true" : "false");
      button.dataset.inkFocus = `width-${choice.value}`;
      button.dataset.width = String(choice.value);
      const sample = button.createSpan({
        cls: `ink-width-preset-sample is-${this.tool}`,
        attr: { "aria-hidden": "true" }
      });
      sample.style.setProperty("--ink-preset-width", `${previewWidth(this.tool, choice.value)}px`);
      sample.style.setProperty("--ink-preset-color", cssColor(color));
      button.createSpan({ text: choice.label });
      button.addEventListener("click", () => {
        this.applyWidth(choice.value);
        this.render();
      });
    }

    const range = this.element.createEl("input", {
      cls: "ink-width-slider",
      attr: { type: "range" }
    });
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
    if (shouldRestoreFocus) {
      const controls = this.element.querySelectorAll<HTMLElement>("[data-ink-focus]");
      const focusTarget = Array.from(controls).find((control) => control.dataset.inkFocus === focusKey);
      (focusTarget ?? this.element).focus({ preventScroll: true });
    }
  }

  private sectionLabel(parent: HTMLElement, text: string): HTMLDivElement {
    return parent.createDiv({ cls: "ink-inspector-section-label", text });
  }

  private selectionMark(parent: HTMLElement): HTMLSpanElement {
    const mark = parent.createSpan({
      cls: "ink-color-swatch-check",
      attr: { "aria-hidden": "true" }
    });
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
