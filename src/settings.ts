import { Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import type { InkStore } from "./storage";
import type { InkSettings } from "./types";

export interface InkSettingsHost {
  store: InkStore;
  refreshInkUI(): void;
}

export class InkSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly pluginHost: Plugin & InkSettingsHost) {
    super(app, pluginHost);
  }

  display(): void {
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
        this.display();
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
      .setDesc("The eraser removes complete strokes that it touches.")
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
