# Changelog

All notable changes to Press PDF Export are documented here.

This project follows semantic versioning where practical.

## 1.1.0 - 2026-07-21

- Fixed missing Mermaid node labels in PDF exports by rendering labels as native SVG text with CJK font fallbacks.
- Added per-diagram captions through `%% caption: ...` comments in Mermaid blocks; an empty caption suppresses the figure caption.
- Fixed the configured Mermaid CLI path so custom `mmdc` installations are used during export.
- Added configurable heading fonts and improved heading and table-of-contents layout.
- Added frontmatter-driven title blocks with title, author, and version metadata.
- Improved PDF title fallback behavior and superscript/subscript rendering.

## 1.0.0 - 2026-04-28

- Prepared community plugin metadata with marketplace id `press-pdf-export`.
- Added export progress notices for single-file, folder, and whole-vault exports.
- Added PDF export through Pandoc with XeLaTeX, pdfLaTeX, LuaLaTeX, wkhtmltopdf, WeasyPrint, and Typst engines.
- Added DOCX and HTML export.
- Added current note, current folder, and whole vault export commands.
- Added optional folder picker commands for one-off export destinations.
- Added right-click menu entries for note and folder PDF export.
- Added Obsidian Markdown preprocessing for callouts, wikilinks, embeds, highlights, comments, image sizes, math, tables, and Mermaid diagrams.
- Added runtime PATH support for Homebrew and BasicTeX/MacTeX CLI tools.
- Added writable temporary directory handling for Pandoc, LaTeX, and LuaLaTeX cache files.
- Added CJK font settings and LaTeX engine support.
