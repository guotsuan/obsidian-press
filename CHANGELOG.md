# Changelog

All notable changes to Press PDF Export are documented here.

This project follows semantic versioning where practical.

## 1.3.0 - 2026-08-05

- Added a frontmatter-driven technical report cover with title, optional subtitle, category, tags, keyword, author, institution, modified date, and version.
- Added cover defaults for `category: Note`, `keyword: Report`, and `institution: 中国科学院上海天文台`, including correct handling of empty frontmatter fields.
- Added leaf-only hierarchical tag display, multi-tag support, and date-only formatting for `modified` timestamps.
- Restyled H2 headings with a blue number tile and light-blue rounded title bar; explicit Markdown numbers are extracted safely, unnumbered headings use a blank tile, and LaTeX math remains supported.
- Improved page placement for large images to prevent clipping while avoiding unnecessary blank pages.
- Added automatic sizing guards for ordinary images while preserving Mermaid diagram sizing.

## 1.2.0 - 2026-08-03

- Fixed local PNG and other Markdown image paths so files resolve relative to the source note, vault root, configured attachment folder, or Obsidian metadata, including images inside embedded notes.
- Set ordinary images to 95% of the available page width by default and cap oversized numeric pixel widths at the same limit, while preserving smaller explicit widths and Mermaid's original sizing.
- Added automatic figure numbering only for images followed by italic `图 X：...` or `Figure X: ...` caption lines; images without these markers remain unnumbered.
- Added language-aware figure labels so Chinese captions use `图` and English captions use `Figure`.
- Added LaTeX math parsing in image captions, preserving commands and supporting `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` delimiters.
- Improved caption parsing for formulas containing asterisks or bracketed expressions.

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
