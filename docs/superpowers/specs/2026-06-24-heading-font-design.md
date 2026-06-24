# Heading Font Setting Design

**Date:** 2026-06-24  
**Status:** Approved

## Problem

All heading levels in exported PDFs use the same font as the document body. There is no way to specify a distinct font for headings, which matters especially for CJK users who want a specific display font (e.g. STHeitiSC-Medium) for titles without changing the body font.

## Goal

Add a single configurable font that applies to all heading levels (H1–H4) in PDFs exported via LaTeX engines.

## Behavior

- A new **Heading font** text field appears in the Typography section of the plugin settings
- Default value: `STHeitiSC-Medium`
- When non-empty and the engine is `xelatex` or `lualatex`: the font is injected into the existing LaTeX header file via `fontspec` + `titlesec`
- When empty: headings use the body font (no injection)
- `pdflatex`: silently skipped — `fontspec` is incompatible with pdflatex
- HTML engines (wkhtmltopdf, weasyprint, typst): not affected

## Design

### Files changed

| File | Change |
|---|---|
| `src/types.ts` | Add `headingFont: string` to `PluginSettings` and `PandocOptions` |
| `src/settings.ts` | Add text input in Typography section |
| `src/exporter.ts` | Pass `headingFont` into `PandocOptions` |
| `src/pandoc.ts` | Accept `headingFont` in `writeListingsHeader`; append LaTeX block when applicable |

### Default value

```ts
headingFont: "STHeitiSC-Medium"
```

Set in the plugin's `DEFAULT_SETTINGS` object in `main.ts`.

### LaTeX injection

Appended to `obsidian-press-listings.tex` when `headingFont` is non-empty and engine is `xelatex` or `lualatex`:

```latex
\usepackage{fontspec}
\usepackage{titlesec}
\newfontfamily\headingfont{STHeitiSC-Medium}
\titleformat{\section}{\headingfont\Large\bfseries}{\thesection}{1em}{}
\titleformat{\subsection}{\headingfont\large\bfseries}{\thesubsection}{1em}{}
\titleformat{\subsubsection}{\headingfont\normalsize\bfseries}{\thesubsubsection}{1em}{}
\titleformat{\paragraph}{\headingfont\normalsize\bfseries}{\theparagraph}{1em}{}
```

Pandoc maps `#` → `\section`, `##` → `\subsection`, `###` → `\subsubsection`, `####` → `\paragraph`.

### Data flow

```
PluginSettings.headingFont
  → exportFile() in exporter.ts
    → PandocOptions.headingFont
      → exportWithPandoc() in pandoc.ts
        → writeListingsHeader(tempDir, engine, headingFont)
```

## Out of scope

- Per-level font control
- HTML/Typst engines
- Font size or color per heading level
- Font validation (invalid font names fail gracefully at pandoc/LaTeX compile time)
