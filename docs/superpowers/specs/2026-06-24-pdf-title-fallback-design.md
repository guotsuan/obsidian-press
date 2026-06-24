# PDF Title Fallback Design

**Date:** 2026-06-24  
**Status:** Approved

## Problem

When a note has no YAML frontmatter `title:` field, the exported PDF has no title at the top — the content just starts immediately. Notes that do have `title:` already get a `# heading` prepended by `stripFrontmatter`. Notes without any frontmatter or without a title field get nothing.

## Goal

Ensure every exported PDF has a meaningful title at the top of the first page, with no user effort required.

## Behavior

| Condition | Result |
|---|---|
| Frontmatter has `title:` | Prepend `# Title` (current behavior, unchanged) |
| No frontmatter `title:`, note starts with a `# heading` | Leave as-is — the heading serves as the title |
| No frontmatter `title:`, note has no `# heading` | Prepend `# Humanized Filename` |

## Design

### Where the change lives

`src/renderer.ts` — in the `renderToPandoc` function, immediately after the `stripFrontmatter` call (Step 1 of the pipeline). `file: TFile` is already available, providing `file.basename` (filename without extension).

### Logic

```
rendered = stripFrontmatter(content)         // existing

if rendered does not start with "# " heading:
    rendered = "# " + humanizeFilename(file.basename) + "\n\n" + rendered
```

The "starts with `# ` heading" check must account for optional leading blank lines after frontmatter is stripped.

### Filename humanization

`file.basename` is already extension-free (Obsidian's `TFile.basename` excludes `.md`).

Transform: split on `-`, `_`, and whitespace → capitalize first letter of each word → join with spaces.

Examples:
- `my-research-note` → `My Research Note`
- `quantum_mechanics_101` → `Quantum Mechanics 101`
- `ProjectUpdate` → `ProjectUpdate` (no splitting on camelCase — keep simple)

### Scope

- One new private helper function `humanizeFilename(basename: string): string`
- ~5 lines added to `renderToPandoc`
- No changes to `pandoc.ts`, `exporter.ts`, `settings.ts`, or any other file
- No new settings — behavior is automatic

## Out of scope

- PDF document metadata title (title bar in PDF reader) — separate concern
- Author / date fields
- CamelCase splitting in filenames
