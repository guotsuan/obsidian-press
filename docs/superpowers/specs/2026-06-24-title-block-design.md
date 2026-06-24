# Title Block Design

**Date:** 2026-06-24  
**Status:** Approved

## Problem

The exported PDF has no centered title block. The title is rendered as a `\section` heading (left-aligned), and there is no author, version, or date shown. Documents look like raw notes rather than finished documents.

## Goal

Add a centered title block at the top of the first content page containing title, optional author, optional version, and last-modified date — with a clear vertical gap before the body content.

## Title Block Layout

```
         My Document Title          ← centered, title font
         Quan Guo                   ← centered, if author available
         2026-06-24 · v1.2          ← centered, date always shown; version appended if present
         [3em gap]
         Body content starts here…
```

## Field Resolution

| Field | Source | Condition |
|---|---|---|
| Title | Frontmatter `title:` → humanized filename | Always shown |
| Author | Frontmatter `author:` → plugin setting `author` | Shown when either source is non-empty |
| Version | Frontmatter `version:` only | Shown only when frontmatter has `version:` |
| Date | `file.stat.mtime` formatted `YYYY-MM-DD` | Always shown |

Version is appended to the date string as `YYYY-MM-DD · vX.Y` rather than passed as a separate pandoc metadata field, since pandoc's default LaTeX template only renders title/author/date natively.

## Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Add `author: string` to `PluginSettings`; add `title`, `author`, `version`, `date` to `RenderResult`; add `docTitle`, `docAuthor`, `docDate` to `PandocOptions` |
| `src/renderer.ts` | `stripFrontmatter` returns `FrontmatterResult { content, title?, author?, version? }` instead of a plain string; remove title heading injection from `renderToPandoc`; `RenderResult` gains metadata fields |
| `src/settings.ts` | Add "Author" text field in a new "Document" section |
| `src/exporter.ts` | Resolve title/author/version/date after `renderToPandoc`; pass as `PandocOptions` metadata |
| `src/pandoc.ts` | Add `--metadata title/author/date` args; add `titling` LaTeX header for post-date spacing |

## Detailed Design

### `stripFrontmatter` return type

```typescript
interface FrontmatterResult {
  content: string;
  title?: string;
  author?: string;
  version?: string;
}
```

Extracts `title:`, `author:`, `version:` from YAML. Does NOT prepend `# Title` to content anymore — that responsibility moves to pandoc metadata.

### `RenderResult` additions

```typescript
interface RenderResult {
  content: string;
  tempFiles: string[];
  title?: string;       // from frontmatter
  author?: string;      // from frontmatter
  version?: string;     // from frontmatter
}
```

### Title resolution in `exporter.ts`

```
title  = rendered.title  ?? humanizeFilename(file.basename)
author = rendered.author ?? settings.author   (empty string → omit)
date   = formatDate(file.stat.mtime)          // "2026-06-24"
date   = version ? `${date} · v${version}` : date
```

### Pandoc args added

```
--metadata title="<title>"
--metadata author="<author>"    ← only when non-empty
--metadata date="<date>"
```

### LaTeX header addition (`pandoc.ts` — `writeListingsHeader`)

Always appended for xelatex/lualatex/pdflatex (independent of heading font setting):

```latex
\usepackage{titling}
\postdate{\par\end{center}\vspace{3em}}
```

## Out of Scope

- Custom date format setting
- Multiple authors
- HTML/DOCX title block styling customization
- Separate title page (`\newpage` after `\maketitle`)
