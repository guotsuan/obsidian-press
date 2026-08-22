import { App, PluginSettingTab, Setting } from "obsidian";
import ObsidianPressPlugin from "./main";
import {
  PdfEngine,
  PdfColorScheme,
  PageSize,
  CodeTheme,
  MermaidTheme,
  OutputFormat,
  OutputNaming,
} from "./types";

export class ObsidianPressSettingTab extends PluginSettingTab {
  plugin: ObsidianPressPlugin;

  constructor(app: App, plugin: ObsidianPressPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Pandoc path")
      .setDesc("Path to the pandoc binary")
      .addText((text) =>
        text
          .setPlaceholder("/opt/homebrew/bin/pandoc")
          .setValue(this.plugin.settings.pandocPath)
          .onChange(async (value) => {
            this.plugin.settings.pandocPath = value || "/opt/homebrew/bin/pandoc";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF engine")
      .setDesc("The PDF rendering engine to use")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("xelatex", "Xelatex (best quality)")
          .addOption("pdflatex", "Pdflatex (auto xelatex for cjk)")
          .addOption("lualatex", "Lualatex")
          .addOption("wkhtmltopdf", "Wkhtmltopdf (lightweight)")
          .addOption("weasyprint", "Weasyprint (CSS-based)")
          .addOption("typst", "Typst (experimental)")
          .setValue(this.plugin.settings.pdfEngine)
          .onChange(async (value: string) => {
            this.plugin.settings.pdfEngine = value as PdfEngine;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default format")
      .setDesc("Default export format")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("pdf", "PDF")
          .addOption("docx", "DOCX")
          .addOption("html", "HTML")
          .setValue(this.plugin.settings.defaultFormat)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultFormat = value as OutputFormat;
            await this.plugin.saveSettings();
          })
      );

    // === Output ===
    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Output directory")
      .setDesc(
        "Relative to vault root, or absolute path. Leave empty for 'PDF' folder"
      )
      .addText((text) =>
        text
          .setPlaceholder("PDF")
          .setValue(this.plugin.settings.outputDir)
          .onChange(async (value) => {
            this.plugin.settings.outputDir = value || "pdf";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("File naming")
      .setDesc("How output files are named")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("same", "Same as source (note.pdf)")
          .addOption("timestamp", "With timestamp (note_2024-01-01t00-00-00.pdf)")
          .addOption("suffix", "With suffix (note_export.pdf)")
          .setValue(this.plugin.settings.outputNaming)
          .onChange(async (value: string) => {
            this.plugin.settings.outputNaming = value as OutputNaming;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open after export")
      .setDesc("Automatically open the exported file after completion")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openAfterExport)
          .onChange(async (value) => {
            this.plugin.settings.openAfterExport = value;
            await this.plugin.saveSettings();
          })
      );

    // === Document ===
    new Setting(containerEl).setName("Document").setHeading();

    new Setting(containerEl)
      .setName("Author")
      .setDesc(
        "Default author shown in the title block. Overridden per-note by frontmatter author: field."
      )
      .addText((text) =>
        text
          .setPlaceholder("Your name")
          .setValue(this.plugin.settings.author)
          .onChange(async (value) => {
            this.plugin.settings.author = value;
            await this.plugin.saveSettings();
          })
      );

    // === Typography ===
    new Setting(containerEl).setName("Typography").setHeading();

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Base font size in points")
      .addText((text) =>
        text
          .setPlaceholder("11")
          .setValue(String(this.plugin.settings.fontSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 72) {
              this.plugin.settings.fontSize = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("PDF line spacing")
      .setDesc("Line spacing multiplier for PDF exports. Defaults to 1.5.")
      .addText((text) =>
        text
          .setPlaceholder("1.5")
          .setValue(String(this.plugin.settings.pdfLineSpacing))
          .onChange(async (value) => {
            const spacing = Number.parseFloat(value);
            if (Number.isFinite(spacing) && spacing >= 1 && spacing <= 3) {
              this.plugin.settings.pdfLineSpacing = spacing;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("PDF color scheme")
      .setDesc(
        "Color theme used only for PDF exports. Formal grayscale uses neutral tones for headings, callouts, links, and code."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("color", "Current color (default)")
          .addOption("grayscale", "Formal grayscale")
          .setValue(this.plugin.settings.pdfColorScheme)
          .onChange(async (value: string) => {
            this.plugin.settings.pdfColorScheme = value as PdfColorScheme;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Page size")
      .setDesc("PDF page dimensions")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("A4", "A4")
          .addOption("Letter", "Letter")
          .addOption("Legal", "Legal")
          .addOption("A3", "A3")
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (value: string) => {
            this.plugin.settings.pageSize = value as PageSize;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Page margin")
      .setDesc("Page margin in millimeters")
      .addText((text) =>
        text
          .setPlaceholder("25")
          .setValue(this.plugin.settings.pageMargin)
          .onChange(async (value) => {
            this.plugin.settings.pageMargin = value || "25";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Code highlight theme")
      .setDesc("Syntax highlighting theme for code blocks")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("tango", "Tango (default)")
          .addOption("pygments", "Pygments (minimal background)")
          .addOption("zenburn", "Zenburn")
          .addOption("breezedark", "Breeze dark")
          .addOption("kate", "Kate")
          .addOption("monochrome", "Monochrome")
          .setValue(this.plugin.settings.codeTheme)
          .onChange(async (value: string) => {
            this.plugin.settings.codeTheme = value as CodeTheme;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cjk font")
      .setDesc(
        "Chinese/japanese/korean font name. On macOS, stheitisc-medium is a reliable xelatex choice."
      )
      .addText((text) =>
        text
          .setPlaceholder("Hiragino sans gb")
          .setValue(this.plugin.settings.cjkFont)
          .onChange(async (value) => {
            this.plugin.settings.cjkFont = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cjk support")
      .setDesc("Add cjk font configuration for LaTeX engines")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCjk)
          .onChange(async (value) => {
            this.plugin.settings.enableCjk = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Heading font")
      .setDesc(
        "Font for all heading levels (h1–h4). LaTeX engines only (xelatex, lualatex). Leave empty to use the body font."
      )
      .addText((text) =>
        text
          .setPlaceholder("Stheitisc-medium")
          .setValue(this.plugin.settings.headingFont)
          .onChange(async (value) => {
            this.plugin.settings.headingFont = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Docx body font")
      .setDesc(
        "Font for normal text in word exports. Defaults to stsong. The font must be installed on the computer opening the docx."
      )
      .addText((text) =>
        text
          .setPlaceholder("Stsong")
          .setValue(this.plugin.settings.docxBodyFont)
          .onChange(async (value) => {
            this.plugin.settings.docxBodyFont = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Docx heading font")
      .setDesc(
        "Font for titles and heading levels in word exports. Defaults to hiragino sans gb."
      )
      .addText((text) =>
        text
          .setPlaceholder("Stheitisc-medium")
          .setValue(this.plugin.settings.docxHeadingFont)
          .onChange(async (value) => {
            this.plugin.settings.docxHeadingFont = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Docx line spacing")
      .setDesc("Line spacing multiplier for word exports. Defaults to 1.5.")
      .addText((text) =>
        text
          .setPlaceholder("1.5")
          .setValue(String(this.plugin.settings.docxLineSpacing))
          .onChange(async (value) => {
            const spacing = Number.parseFloat(value);
            if (Number.isFinite(spacing) && spacing >= 1 && spacing <= 3) {
              this.plugin.settings.docxLineSpacing = spacing;
              await this.plugin.saveSettings();
            }
          })
      );

    // === Advanced ===
    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Custom CSS file")
      .setDesc(
        "Path to custom CSS file (relative to vault root, for HTML-based engines)"
      )
      .addText((text) =>
        text
          .setPlaceholder("styles/custom-pdf.css")
          .setValue(this.plugin.settings.customCssPath)
          .onChange(async (value) => {
            this.plugin.settings.customCssPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom pandoc template")
      .setDesc("Path to custom pandoc template file")
      .addText((text) =>
        text
          .setPlaceholder("templates/custom.html")
          .setValue(this.plugin.settings.customTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.customTemplatePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mermaid CLI path")
      .setDesc("Path to mmdc binary for Mermaid diagram rendering")
      .addText((text) =>
        text
          .setPlaceholder("Mmdc")
          .setValue(this.plugin.settings.mermaidPath)
          .onChange(async (value) => {
            this.plugin.settings.mermaidPath = value || "mmdc";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mermaid theme")
      .setDesc("Theme for Mermaid diagrams")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "Default")
          .addOption("dark", "Dark")
          .addOption("forest", "Forest")
          .addOption("neutral", "Neutral")
          .setValue(this.plugin.settings.mermaidTheme)
          .onChange(async (value: string) => {
            this.plugin.settings.mermaidTheme = value as MermaidTheme;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra pandoc arguments")
      .setDesc("Additional command-line arguments passed to pandoc")
      .addText((text) =>
        text
          .setPlaceholder("--pdf-engine-opt=--enable-local-file-access")
          .setValue(this.plugin.settings.extraArgs)
          .onChange(async (value) => {
            this.plugin.settings.extraArgs = value;
            await this.plugin.saveSettings();
          })
      );

    // === Batch ===
    new Setting(containerEl).setName("Batch export").setHeading();

    new Setting(containerEl)
      .setName("Concurrency")
      .setDesc("Number of files to export in parallel")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.concurrency))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 20) {
              this.plugin.settings.concurrency = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Skip errors")
      .setDesc("Continue exporting remaining files if one fails")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skipErrors)
          .onChange(async (value) => {
            this.plugin.settings.skipErrors = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
