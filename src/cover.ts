export interface CoverMetadata {
  title: string;
  subtitle?: string;
  category?: string;
  tags?: string[];
  keyword?: string;
  author?: string;
  institution?: string;
  version?: string;
  date: string;
}

/** Build a clean technical-report cover and put the TOC on page two. */
export function buildLatexCoverPage(metadata: CoverMetadata): string {
  const title = escapeLatexPreservingMath(metadata.title);
  const subtitle = metadata.subtitle?.trim()
    ? escapeLatexPreservingMath(metadata.subtitle.trim())
    : undefined;
  const category = metadata.category
    ? escapeLatexPreservingMath(metadata.category)
    : "Note";
  const tagLeaves = (metadata.tags ?? [])
    .map(extractTagLeaf)
    .filter(Boolean);
  const tags = tagLeaves.length
    ? tagLeaves.map(escapeLatexPreservingMath).join(" · ")
    : "未分类";
  const keyword = metadata.keyword
    ? escapeLatexPreservingMath(metadata.keyword)
    : "Report";
  const author = metadata.author
    ? escapeLatexPreservingMath(metadata.author)
    : "\\textemdash{}";
  const institution = metadata.institution
    ? escapeLatexPreservingMath(metadata.institution)
    : "中国科学院上海天文台";
  const version = metadata.version
    ? escapeLatexPreservingMath(formatVersion(metadata.version))
    : "\\textemdash{}";
  const date = escapeLatexPreservingMath(formatDateOnly(metadata.date));

  return [
    "```{=latex}",
    "\\begin{titlepage}",
    "\\thispagestyle{empty}",
    "\\begin{tikzpicture}[remember picture,overlay]",
    "% Light technical-document ground and a strong blue spine.",
    "\\fill[CoverPaper] (current page.south west) rectangle (current page.north east);",
    "\\fill[CoverBlue] (current page.south west) rectangle ($(current page.north west)+(25mm,0)$);",
    "% Document tags run vertically inside the spine.",
    `\\node[rotate=90,align=center,text=white,font=\\coverheadingfont\\bfseries\\fontsize{13}{18}\\selectfont] at ($(current page.west)+(12.5mm,0)$) {${tags}};`,
    "% Editorial title block.",
    `\\node[anchor=north west,text=CoverInk,font=\\coverheadingfont\\bfseries\\fontsize{12}{15}\\selectfont] at ($(current page.north west)+(47mm,-54mm)$) {${category} — ${institution}};`,
    `\\node[anchor=north west,align=left,text width=0.69\\paperwidth,text=CoverBlue] at ($(current page.north west)+(47mm,-69mm)$) {{\\coverheadingfont\\bfseries\\boldmath\\fontsize{27}{33}\\selectfont ${title}}};`,
    ...(subtitle
      ? [
          `\\node[anchor=north west,align=left,text width=0.69\\paperwidth,text=CoverInk] at ($(current page.north west)+(47mm,-94mm)$) {{\\sffamily\\itshape\\boldmath\\fontsize{15}{20}\\selectfont ${subtitle}}};`,
        ]
      : []),
    "% A restrained repository/network motif in the center.",
    "\\begin{scope}[shift={($(current page.center)+(12mm,-12mm)$)}]",
    "\\foreach \\angle in {0,60,...,300} {",
    "  \\draw[CoverLine,line width=0.65pt] (\\angle:12mm) -- (\\angle:34mm);",
    "  \\fill[CoverPlum] (\\angle:34mm) circle (1.35mm);",
    "}",
    "\\foreach \\angle in {30,90,...,330} {",
    "  \\draw[CoverLine,densely dashed,line width=0.45pt] (\\angle:12mm) -- (\\angle:43mm);",
    "  \\draw[CoverRed,fill=CoverPaper,line width=0.75pt] (\\angle:43mm) circle (1.25mm);",
    "}",
    "\\draw[CoverBlue,fill=CoverPaper,line width=1.3pt] (0,0) circle (12mm);",
    `\\node[align=center,text width=20mm,text=CoverBlue,font=\\coverheadingfont\\bfseries\\fontsize{10.5}{12.5}\\selectfont] at (0,0) {${keyword}};`,
    `\\node[anchor=north,text=CoverMuted,font=\\sffamily\\fontsize{7.5}{9}\\selectfont] at (0,-49mm) {${institution}};`,
    "\\end{scope}",
    "% Bottom metadata block.",
    "\\draw[CoverInk,line width=0.7pt] ($(current page.south west)+(47mm,70mm)$) -- ($(current page.south east)+(-18mm,70mm)$);",
    `\\node[anchor=north west,align=left,text width=0.69\\paperwidth,text=CoverInk] at ($(current page.south west)+(47mm,62mm)$) {{\\sffamily\\fontsize{11.5}{16}\\selectfont \\textbf{作者：} ${author}\\\\\\textbf{更新：} ${date}\\\\\\textbf{版本：} ${version}}};`,
    "\\end{tikzpicture}",
    "\\null",
    "\\end{titlepage}",
    "\\tableofcontents",
    "\\clearpage",
    "```",
  ].join("\n");
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Keep only the calendar date from an ISO-style modified timestamp. */
function formatDateOnly(value: string): string {
  const trimmed = value.trim();
  return trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? trimmed;
}

function formatVersion(version?: string): string {
  const trimmed = version?.trim();
  if (!trimmed) return "";
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
}

/** Convert an Obsidian hierarchical tag to its final display segment. */
function extractTagLeaf(tag: string): string {
  const normalized = tag
    .trim()
    .replace(/^-\s*/, "")
    .replace(/^#+/, "")
    .replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1]?.trim() ?? "";
}

/** Escape ordinary text but leave dollar-delimited LaTeX math untouched. */
function escapeLatexPreservingMath(value: string): string {
  const mathRegex = /(\$\$[^$]+\$\$|\$(?:\\.|[^$\\])+\$)/g;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(value)) !== null) {
    result += escapeLatexText(value.slice(cursor, match.index));
    result += match[0];
    cursor = mathRegex.lastIndex;
  }

  return result + escapeLatexText(value.slice(cursor));
}

function escapeLatexText(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[&%$#_{}~^]/g, (character) => `\\${character}`);
}
