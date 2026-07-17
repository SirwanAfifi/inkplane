import {
  Plugin,
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem
} from "obsidian";
import type { InkStore } from "./storage";
import type { InkSettings } from "./types";

export interface InkSettingsHost {
  store: InkStore;
  refreshInkUI(): void;
}

type InkSettingKey = keyof InkSettings | "matchPenToTheme";

export class InkSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly pluginHost: Plugin & InkSettingsHost) {
    super(app, pluginHost);
  }

  getSettingDefinitions(): SettingDefinitionItem<InkSettingKey>[] {
    return [
      {
        type: "group",
        heading: "Drawing files",
        items: [
          {
            name: "Drawing folder",
            desc: "New .inklayer canvases are stored here inside the vault. Leave blank for the vault root.",
            control: { type: "folder", key: "drawingFolder", placeholder: "Inkplane" }
          },
          {
            name: "Embed width",
            desc: "Default width for previews inserted into notes.",
            control: { type: "number", key: "defaultEmbedWidth", min: 240, max: 2400, step: 1 }
          },
          {
            name: "Embed height",
            desc: "Default height for previews inserted into notes.",
            control: { type: "number", key: "defaultEmbedHeight", min: 180, max: 1800, step: 1 }
          }
        ]
      },
      {
        type: "group",
        heading: "Ink appearance",
        items: [
          {
            name: "Match pen to the theme",
            desc: "Use Obsidian’s current text color for new pen strokes.",
            control: { type: "toggle", key: "matchPenToTheme" }
          },
          {
            name: "Pen color",
            desc: "Color for new pen strokes when theme matching is disabled.",
            control: {
              type: "color",
              key: "penColor",
              disabled: () => this.pluginHost.store.settings.penColor === "adaptive"
            }
          },
          {
            name: "Pen width",
            desc: "Base width. Pencil pressure varies the final width.",
            control: { type: "slider", key: "penWidth", min: 1, max: 12, step: 0.2 }
          },
          {
            name: "Highlighter color",
            control: { type: "color", key: "highlighterColor" }
          },
          {
            name: "Highlighter width",
            control: { type: "slider", key: "highlighterWidth", min: 6, max: 40, step: 1 }
          },
          {
            name: "Eraser size",
            desc: "The eraser removes only the area of a stroke that it touches.",
            control: { type: "slider", key: "eraserWidth", min: 8, max: 56, step: 2 }
          },
          {
            name: "Pressure response",
            desc: "Zero gives a uniform line; one follows the full pressure range reported by the pen.",
            control: { type: "slider", key: "pressureSensitivity", min: 0, max: 1, step: 0.05 }
          }
        ]
      },
      {
        type: "group",
        heading: "Input and navigation",
        items: [
          {
            name: "Palm rejection",
            desc: "Ignore touch contacts while a pen is active or was just detected nearby.",
            control: { type: "toggle", key: "palmRejection" }
          },
          {
            name: "Draw with a finger",
            desc: "Off by default: one finger pans and two fingers pinch-zoom while Apple Pencil draws.",
            control: { type: "toggle", key: "allowFingerDrawing" }
          },
          {
            name: "Draw with a mouse",
            desc: "Useful for desktop editing and testing without a pen.",
            control: { type: "toggle", key: "allowMouseDrawing" }
          },
          {
            name: "Toolbar position",
            desc: "The bottom position respects the iPad safe area.",
            control: {
              type: "dropdown",
              key: "toolbarPosition",
              options: { top: "Top", bottom: "Bottom" }
            }
          }
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.pluginHost.store.settings;
    if (key === "matchPenToTheme") return settings.penColor === "adaptive";
    if (key === "penColor" && settings.penColor === "adaptive") return "#1f2937";
    return settings[key as keyof InkSettings];
  }

  setControlValue(key: string, value: unknown): void {
    if (key === "matchPenToTheme") {
      if (typeof value !== "boolean") return;
      this.applyPatch({ penColor: value ? "adaptive" : "#1f2937" });
      this.update();
      return;
    }
    if (key === "drawingFolder" || key === "penColor" || key === "highlighterColor") {
      if (typeof value !== "string") return;
      this.applyPatch({ [key]: key === "drawingFolder" ? value.trim() : value });
      return;
    }
    if (key === "palmRejection" || key === "allowFingerDrawing" || key === "allowMouseDrawing") {
      if (typeof value !== "boolean") return;
      this.applyPatch({ [key]: value });
      return;
    }
    if (key === "toolbarPosition") {
      this.applyPatch({ toolbarPosition: value === "bottom" ? "bottom" : "top" });
      return;
    }
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue)) return;
    if (key === "defaultEmbedWidth") this.applyPatch({ defaultEmbedWidth: clampRound(numberValue, 240, 2400) });
    else if (key === "defaultEmbedHeight") this.applyPatch({ defaultEmbedHeight: clampRound(numberValue, 180, 1800) });
    else if (key === "penWidth") this.applyPatch({ penWidth: clamp(numberValue, 1, 12) });
    else if (key === "highlighterWidth") this.applyPatch({ highlighterWidth: clamp(numberValue, 6, 40) });
    else if (key === "eraserWidth") this.applyPatch({ eraserWidth: clamp(numberValue, 8, 56) });
    else if (key === "pressureSensitivity") this.applyPatch({ pressureSensitivity: clamp(numberValue, 0, 1) });
  }

  display(): void {
    this.renderLegacy();
  }

  private renderLegacy(): void {
    this.containerEl.replaceChildren();
    const settings = this.pluginHost.store.settings;

    new Setting(this.containerEl).setName("Drawing files").setHeading();

    new Setting(this.containerEl)
      .setName("Drawing folder")
      .setDesc("New .inklayer canvases are stored here inside the vault. Leave blank for the vault root.")
      .addText((text) => text
        .setPlaceholder("Inkplane")
        .setValue(settings.drawingFolder)
        .onChange((value) => this.applyPatch({ drawingFolder: value.trim() })));

    this.addNumberSetting(
      "Embed width",
      "Default width for previews inserted into notes.",
      settings.defaultEmbedWidth,
      240,
      2400,
      (value) => ({ defaultEmbedWidth: value })
    );
    this.addNumberSetting(
      "Embed height",
      "Default height for previews inserted into notes.",
      settings.defaultEmbedHeight,
      180,
      1800,
      (value) => ({ defaultEmbedHeight: value })
    );

    new Setting(this.containerEl).setName("Ink appearance").setHeading();

    new Setting(this.containerEl)
      .setName("Match pen to the theme")
      .setDesc("Use Obsidian’s current text color for new pen strokes.")
      .addToggle((toggle) => toggle.setValue(settings.penColor === "adaptive").onChange((enabled) => {
        this.applyPatch({ penColor: enabled ? "adaptive" : "#1f2937" });
        this.renderLegacy();
      }));

    new Setting(this.containerEl)
      .setName("Pen color")
      .setDesc(settings.penColor === "adaptive" ? "Disable theme matching to choose a fixed color." : "Color for new pen strokes.")
      .setDisabled(settings.penColor === "adaptive")
      .addColorPicker((picker) => picker
        .setValue(settings.penColor === "adaptive" ? "#1f2937" : settings.penColor)
        .setDisabled(settings.penColor === "adaptive")
        .onChange((value) => this.applyPatch({ penColor: value })));

    new Setting(this.containerEl)
      .setName("Pen width")
      .setDesc("Base width. Pencil pressure varies the final width.")
      .addSlider((slider) => slider
        .setLimits(1, 12, 0.2)
        .setValue(settings.penWidth)
        .setInstant(false)
        .onChange((value) => this.applyPatch({ penWidth: value })));

    new Setting(this.containerEl)
      .setName("Highlighter color")
      .addColorPicker((picker) => picker
        .setValue(settings.highlighterColor)
        .onChange((value) => this.applyPatch({ highlighterColor: value })));

    new Setting(this.containerEl)
      .setName("Highlighter width")
      .addSlider((slider) => slider
        .setLimits(6, 40, 1)
        .setValue(settings.highlighterWidth)
        .setInstant(false)
        .onChange((value) => this.applyPatch({ highlighterWidth: value })));

    new Setting(this.containerEl)
      .setName("Eraser size")
      .setDesc("The eraser removes only the area of a stroke that it touches.")
      .addSlider((slider) => slider
        .setLimits(8, 56, 2)
        .setValue(settings.eraserWidth)
        .setInstant(false)
        .onChange((value) => this.applyPatch({ eraserWidth: value })));

    new Setting(this.containerEl)
      .setName("Pressure response")
      .setDesc("Zero gives a uniform line; one follows the full pressure range reported by the pen.")
      .addSlider((slider) => slider
        .setLimits(0, 1, 0.05)
        .setValue(settings.pressureSensitivity)
        .setInstant(false)
        .onChange((value) => this.applyPatch({ pressureSensitivity: value })));

    new Setting(this.containerEl).setName("Input and navigation").setHeading();

    new Setting(this.containerEl)
      .setName("Palm rejection")
      .setDesc("Ignore touch contacts while a pen is active or was just detected nearby.")
      .addToggle((toggle) => toggle
        .setValue(settings.palmRejection)
        .onChange((value) => this.applyPatch({ palmRejection: value })));

    new Setting(this.containerEl)
      .setName("Draw with a finger")
      .setDesc("Off by default: one finger pans and two fingers pinch-zoom while Apple Pencil draws.")
      .addToggle((toggle) => toggle
        .setValue(settings.allowFingerDrawing)
        .onChange((value) => this.applyPatch({ allowFingerDrawing: value })));

    new Setting(this.containerEl)
      .setName("Draw with a mouse")
      .setDesc("Useful for desktop editing and testing without a pen.")
      .addToggle((toggle) => toggle
        .setValue(settings.allowMouseDrawing)
        .onChange((value) => this.applyPatch({ allowMouseDrawing: value })));

    new Setting(this.containerEl)
      .setName("Toolbar position")
      .setDesc("The bottom position respects the iPad safe area.")
      .addDropdown((dropdown) => dropdown
        .addOption("top", "Top")
        .addOption("bottom", "Bottom")
        .setValue(settings.toolbarPosition)
        .onChange((value) => this.applyPatch({ toolbarPosition: value === "bottom" ? "bottom" : "top" })));
  }

  private addNumberSetting(
    name: string,
    description: string,
    current: number,
    minimum: number,
    maximum: number,
    patch: (value: number) => Partial<InkSettings>
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setValue(String(current))
        .onChange((value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return;
          this.applyPatch(patch(Math.round(Math.min(maximum, Math.max(minimum, parsed)))));
        }));
  }

  private applyPatch(patch: Partial<InkSettings>): void {
    this.pluginHost.store.updateSettings(patch);
    this.pluginHost.refreshInkUI();
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampRound(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum));
}
