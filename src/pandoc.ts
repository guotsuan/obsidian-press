import * as path from "path";
import * as fs from "fs";
import { PandocOptions, ExportResult } from "./types";
import { spawn } from "child_process";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// === Build Pandoc args array (no shell escaping issues) ===

function buildPandocArgs(options: PandocOptions): string[] {
  const {
    inputPath,
    outputPath,
    format,
    engine,
    fontSize,
    pageSize,
    pageMargin,
    codeTheme,
    cjkFont,
    enableCjk,
    customCssPath,
    customTemplatePath,
    extraArgs,
  } = options;
  const listingsHeaderPath = path.join(options.tempDir, "obsidian-press-listings.tex");
  const calloutFilterPath = path.join(options.tempDir, "obsidian-press-callouts.lua");

  const args: string[] = [
    inputPath,
    "-o",
    outputPath,
    "--from",
    "markdown+fenced_code_blocks+fenced_code_attributes+fenced_divs+raw_attribute+backtick_code_blocks+pipe_tables+grid_tables+raw_html+tex_math_dollars+tex_math_single_backslash+tex_math_double_backslash+superscript+subscript",
    "--to",
    format === "pdf" ? "pdf" : format === "docx" ? "docx" : "html5",
    "--standalone",
    // For LaTeX engines the TOC is injected manually inside the raw LaTeX
    // title block so it appears AFTER the title on the same page. Pandoc's
    // auto-TOC placement always comes before the document body, which would
    // put the TOC before the title. For other engines keep auto-TOC.
    ...(format === "pdf" && ["xelatex","lualatex","pdflatex"].includes(engine)
      ? []
      : ["--toc", "--toc-depth=3"]),
    `--highlight-style=${codeTheme}`,
    "--resource-path",
    path.dirname(inputPath),
  ];

  // Engine-specific args
  const latexBase = [
    "-V",
    `geometry:margin=${pageMargin}mm`,
    "-V",
    `fontsize=${fontSize}pt`,
    "-V",
    `papersize=${pageSize.toLowerCase()}`,
  ];

  if (format === "pdf") switch (engine) {
    case "xelatex":
      args.push(
        `--lua-filter=${calloutFilterPath}`,
        "--pdf-engine=xelatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        ...getCjkArgs(engine, enableCjk, cjkFont),
        "-V",
        "colorlinks=true"
      );
      break;
    case "pdflatex":
      args.push(
        `--lua-filter=${calloutFilterPath}`,
        "--pdf-engine=pdflatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        "-V",
        "colorlinks=true"
      );
      break;
    case "lualatex":
      args.push(
        `--lua-filter=${calloutFilterPath}`,
        "--pdf-engine=lualatex",
        "--listings",
        "-H",
        listingsHeaderPath,
        ...latexBase,
        ...getCjkArgs(engine, enableCjk, cjkFont),
        "-V",
        "colorlinks=true"
      );
      break;
    case "wkhtmltopdf":
      args.push(
        "--pdf-engine=wkhtmltopdf",
        "-V",
        `margin-top=${pageMargin}mm`,
        "-V",
        `margin-bottom=${pageMargin}mm`,
        "-V",
        `margin-left=${pageMargin}mm`,
        "-V",
        `margin-right=${pageMargin}mm`
      );
      break;
    case "weasyprint":
      args.push("--pdf-engine=weasyprint", "-V", `margin=${pageMargin}mm`);
      break;
    case "typst":
      args.push(
        "--pdf-engine=typst",
        "-V",
        `font-size=${fontSize}pt`,
        "-V",
        `page-size=${pageSize.toLowerCase()}`
      );
      break;
  }

  if (format === "docx" && options.docxReferencePath) {
    args.push(`--reference-doc=${options.docxReferencePath}`);
  }
  if (format === "docx" && options.docxTocTitle) {
    args.push("--metadata", `toc-title=${options.docxTocTitle}`);
  }

  // CSS for HTML-based engines
  if (
    (engine === "wkhtmltopdf" || engine === "weasyprint") &&
    customCssPath
  ) {
    args.push("--css", customCssPath);
  }

  // Template
  if (customTemplatePath && format !== "docx") {
    args.push("--template", customTemplatePath);
  }

  // Document metadata for title block
  if (options.docTitle) {
    args.push("--metadata", `title=${options.docTitle}`);
  }
  if (options.docAuthor) {
    args.push("--metadata", `author=${options.docAuthor}`);
  }
  if (options.docDate) {
    args.push("--metadata", `date=${options.docDate}`);
  }
  if (engine === "typst" && options.figureLabel) {
    args.push(
      "--metadata",
      `lang=${options.figureLabel === "图" ? "zh" : "en"}`
    );
  }

  // Extra args
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

function normalizeCjkFontName(fontName: string): string {
  const trimmed = fontName.trim();
  if (process.platform === "darwin" && trimmed === "PingFang SC") {
    return "STHeitiSC-Medium";
  }
  return trimmed;
}

function getCjkArgs(
  engine: string,
  enableCjk: boolean,
  cjkFont: string
): string[] {
  if (!enableCjk) return [];

  const resolved = normalizeCjkFontName(cjkFont);
  if (resolved) {
    return ["-V", `CJKmainfont=${resolved}`];
  }

  if (process.platform === "darwin" && engine === "xelatex") {
    return ["-V", "CJKmainfont=STHeitiSC-Medium"];
  }

  return [];
}

// === Export with Pandoc (spawn with array, no shell escaping issues) ===

export async function exportWithPandoc(
  options: PandocOptions
): Promise<ExportResult> {
  const startTime = Date.now();
  const pandocPath = options.pandocPath || "pandoc";

  // Verify input file exists
  if (!fs.existsSync(options.inputPath)) {
    return {
      success: false,
      error: `Input file not found: ${options.inputPath}`,
      duration: Date.now() - startTime,
    };
  }

  // Ensure output directory exists
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!fs.existsSync(options.tempDir)) {
    fs.mkdirSync(options.tempDir, { recursive: true });
  }
  writeListingsHeader(
    options.tempDir,
    options.engine,
    options.headingFont,
    options.enableCjk,
    options.fontSize,
    options.figureLabel
  );
  writeCalloutFilter(options.tempDir);
  let resolvedOptions = options;
  if (
    options.format === "docx" &&
    (options.docxBodyFont.trim() ||
      options.docxHeadingFont.trim() ||
      options.docxLineSpacing !== 1)
  ) {
    try {
      const docxReferencePath = await writeDocxReference(options);
      resolvedOptions = { ...options, docxReferencePath };
    } catch (err) {
      return {
        success: false,
        error: `Failed to prepare DOCX fonts: ${
          err instanceof Error ? err.message : String(err)
        }`,
        duration: Date.now() - startTime,
      };
    }
  }
  const texCacheDir = path.join(options.tempDir, "tex-cache");
  if (!fs.existsSync(texCacheDir)) {
    fs.mkdirSync(texCacheDir, { recursive: true });
  }

  const args = buildPandocArgs(resolvedOptions);

  return new Promise((resolve) => {
    // Use spawn with array args and shell: false — pandocPath is used as the
    // executable directly, never appears in the args array.
    const child = spawn(pandocPath, args, {
      shell: false,
      cwd: options.tempDir,
      stdio: "pipe",
      timeout: 120000,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
        TMPDIR: options.tempDir,
        TMP: options.tempDir,
        TEMP: options.tempDir,
        TEXMFVAR: texCacheDir,
        TEXMFCACHE: texCacheDir,
        LANG: process.env.LANG || "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      },
    });

    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const duration = Date.now() - startTime;

      if (code === 0) {
        if (fs.existsSync(options.outputPath)) {
          const stats = fs.statSync(options.outputPath);
          if (stats.size > 0) {
            resolve({
              success: true,
              outputPath: options.outputPath,
              duration,
            });
            return;
          }
        }
        resolve({
          success: false,
          error: "Output file was not created or is empty",
          duration,
        });
        return;
      }

      // Parse error
      const errorMsg = parsePandocError(stderr, code);
      resolve({ success: false, error: errorMsg, duration });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to run pandoc: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

async function writeDocxReference(options: PandocOptions): Promise<string> {
  const bodyFont = options.docxBodyFont.trim();
  const headingFont = options.docxHeadingFont.trim();
  const referenceData = await readPandocReferenceDoc(options.pandocPath || "pandoc");
  const archive = unzipSync(new Uint8Array(referenceData));
  const themePath = "word/theme/theme1.xml";
  const themeData = archive[themePath];
  if (!themeData) {
    throw new Error("Pandoc reference.docx does not contain word/theme/theme1.xml");
  }

  let themeXml = strFromU8(themeData);
  if (headingFont) {
    themeXml = replaceDocxThemeFont(themeXml, "majorFont", headingFont);
  }
  if (bodyFont) {
    themeXml = replaceDocxThemeFont(themeXml, "minorFont", bodyFont);
  }
  archive[themePath] = strToU8(themeXml);

  const stylesPath = "word/styles.xml";
  const stylesData = archive[stylesPath];
  if (!stylesData) {
    throw new Error("Pandoc reference.docx does not contain word/styles.xml");
  }
  let stylesXml = strFromU8(stylesData);
  if (bodyFont) {
    stylesXml = replaceDocxDefaultFont(stylesXml, bodyFont);
  }
  if (headingFont) {
    stylesXml = replaceDocxHeadingFonts(stylesXml, headingFont);
  }
  stylesXml = replaceDocxLineSpacing(stylesXml, options.docxLineSpacing);
  archive[stylesPath] = strToU8(stylesXml);

  const fontKey = Buffer.from(
    `${bodyFont}\u0000${headingFont}\u0000${options.docxLineSpacing}`,
    "utf8"
  )
    .toString("hex")
    .slice(0, 32);
  const referencePath = path.join(
    options.tempDir,
    `obsidian-press-reference-${fontKey}.docx`
  );
  fs.writeFileSync(referencePath, Buffer.from(zipSync(archive, { level: 6 })));
  return referencePath;
}

function replaceDocxLineSpacing(stylesXml: string, multiplier: number): string {
  const normalized = Number.isFinite(multiplier)
    ? Math.min(3, Math.max(1, multiplier))
    : 1.5;
  const line = Math.round(normalized * 240);
  const defaultParagraphRegex = /(<w:pPrDefault>[\s\S]*?<w:pPr>)([\s\S]*?)(<\/w:pPr>[\s\S]*?<\/w:pPrDefault>)/;
  if (!defaultParagraphRegex.test(stylesXml)) {
    throw new Error("Could not locate the default paragraph style in reference.docx");
  }
  return stylesXml.replace(
    defaultParagraphRegex,
    (_match, open: string, body: string, close: string) => {
      const spacingRegex = /<w:spacing\b([^>]*)\/>/;
      if (spacingRegex.test(body)) {
        const updated = body.replace(spacingRegex, (_tag, attributes: string) => {
          const preserved = attributes
            .replace(/\s+w:line="[^"]*"/g, "")
            .replace(/\s+w:lineRule="[^"]*"/g, "");
          return `<w:spacing${preserved} w:line="${line}" w:lineRule="auto" />`;
        });
        return open + updated + close;
      }
      return `${open}<w:spacing w:line="${line}" w:lineRule="auto" />${body}${close}`;
    }
  );
}

function docxRunFonts(fontName: string): string {
  const font = escapeXmlAttribute(fontName);
  return `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}" />`;
}

function replaceDocxDefaultFont(stylesXml: string, fontName: string): string {
  const defaultsRegex = /(<w:rPrDefault>[\s\S]*?<w:rPr>[\s\S]*?)<w:rFonts\b[^>]*\/>/;
  if (!defaultsRegex.test(stylesXml)) {
    throw new Error("Could not locate the default font style in reference.docx");
  }
  return stylesXml.replace(defaultsRegex, `$1${docxRunFonts(fontName)}`);
}

function replaceDocxHeadingFonts(stylesXml: string, fontName: string): string {
  const headingStyleRegex =
    /<w:style\b(?=[^>]*w:styleId="(?:Title|TitleChar|Subtitle|SubtitleChar|Heading[1-9](?:Char)?|TOCHeading)")[\s\S]*?<\/w:style>/g;
  const runFonts = docxRunFonts(fontName);
  return stylesXml.replace(headingStyleRegex, (style) => {
    if (/<w:rFonts\b[^>]*\/>/.test(style)) {
      return style.replace(/<w:rFonts\b[^>]*\/>/, runFonts);
    }
    if (/<w:rPr>/.test(style)) {
      return style.replace(/<w:rPr>/, `<w:rPr>${runFonts}`);
    }
    return style.replace(/<\/w:style>/, `<w:rPr>${runFonts}</w:rPr></w:style>`);
  });
}

function replaceDocxThemeFont(
  themeXml: string,
  themeGroup: "majorFont" | "minorFont",
  fontName: string
): string {
  const escapedFont = escapeXmlAttribute(fontName);
  const groupRegex = new RegExp(
    `(<a:${themeGroup}>)([\\s\\S]*?)(</a:${themeGroup}>)`
  );
  return themeXml.replace(groupRegex, (_match, open: string, body: string, close: string) => {
    const updated = body.replace(
      /<a:(latin|ea|cs)\b[^>]*\/>/g,
      (_tag, kind: string) => `<a:${kind} typeface="${escapedFont}"/>`
    );
    return open + updated + close;
  });
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readPandocReferenceDoc(pandocPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pandocPath,
      ["--print-default-data-file", "reference.docx"],
      { shell: false, stdio: "pipe" }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(stderr.trim() || `Pandoc exited with code ${code}`));
      }
    });
  });
}

function writeCalloutFilter(tempDir: string): void {
  const filterPath = path.join(tempDir, "obsidian-press-callouts.lua");
  const filter = String.raw`local function has_class(classes, expected)
  for _, class_name in ipairs(classes) do
    if class_name == expected then
      return true
    end
  end
  return false
end

local latex_replacements = {
  ["\\"] = "\\textbackslash{}",
  ["{"] = "\\{",
  ["}"] = "\\}",
  ["$"] = "\\$",
  ["&"] = "\\&",
  ["#"] = "\\#",
  ["%"] = "\\%",
  ["_"] = "\\_",
  ["~"] = "\\textasciitilde{}",
  ["^"] = "\\textasciicircum{}",
}

local function escape_latex(text)
  return text:gsub("[\\{}$&#%%_~^]", latex_replacements)
end

function Div(div)
  if not has_class(div.classes, "callout") then
    return nil
  end

  local callout_type = div.attributes["callout-type"] or "note"
  local title = escape_latex(div.attributes["callout-title"] or callout_type)
  local blocks = pandoc.List({
    pandoc.RawBlock("latex", "\\begin{presscallout}{" .. callout_type .. "}{" .. title .. "}")
  })
  blocks:extend(div.content)
  blocks:insert(pandoc.RawBlock("latex", "\\end{presscallout}"))
  return blocks
end
`;
  fs.writeFileSync(filterPath, filter, "utf8");
}

function writeListingsHeader(
  tempDir: string,
  engine: string,
  headingFont: string,
  enableCjk: boolean,
  fontSize: number,
  figureLabel?: "图" | "Figure"
): void {
  const headerPath = path.join(tempDir, "obsidian-press-listings.tex");
  const coverContent = String.raw`\usepackage{xcolor}
\usepackage{tikz}
\usepackage{needspace}
\usepackage[most]{tcolorbox}
\usetikzlibrary{calc}
\definecolor{CoverPaper}{HTML}{F7F8FC}
\definecolor{CoverBlue}{HTML}{3D6694}
\definecolor{CoverPlum}{HTML}{6C5874}
\definecolor{CoverRed}{HTML}{D84A4A}
\definecolor{CoverLine}{HTML}{C9CBD2}
\definecolor{CoverInk}{HTML}{17191D}
\definecolor{CoverMuted}{HTML}{747982}
\definecolor{HeadingBlue}{HTML}{2F67A0}
\definecolor{HeadingTint}{HTML}{EDF3F9}
\newcommand{\pressdefinecalloutpalette}[6]{%
  \definecolor{CalloutFrame#1}{HTML}{#2}%
  \definecolor{CalloutTitle#1}{HTML}{#3}%
  \definecolor{CalloutBody#1}{HTML}{#4}%
  \definecolor{CalloutAccent#1}{HTML}{#5}%
  \definecolor{CalloutInk#1}{HTML}{#6}%
}
\pressdefinecalloutpalette{note}{448AFF}{DCE8FC}{E8F0FE}{1A73E8}{3F4650}
\pressdefinecalloutpalette{summary}{58547D}{DDDBD5}{F2E7DB}{C16D88}{55527C}
\pressdefinecalloutpalette{tip}{00BFA5}{C9F0EA}{E0F7FA}{00897B}{344B4A}
\pressdefinecalloutpalette{important}{7C4DFF}{DDD2FA}{EDE7F6}{651FFF}{49405D}
\pressdefinecalloutpalette{warning}{FF9100}{FFE0B2}{FFF3E0}{E65100}{57493D}
\pressdefinecalloutpalette{caution}{FF5252}{FFD0D3}{FFEBEE}{D50000}{594044}
\pressdefinecalloutpalette{abstract}{448AFF}{D9DEF4}{E8EAF6}{283593}{41475F}
\pressdefinecalloutpalette{info}{448AFF}{CFE8FA}{E3F2FD}{1565C0}{3D4B57}
\pressdefinecalloutpalette{todo}{448AFF}{DCE8FC}{E8F0FE}{1A73E8}{3F4650}
\pressdefinecalloutpalette{example}{7C4DFF}{E3CEE9}{F3E5F5}{7B1FA2}{504154}
\pressdefinecalloutpalette{quote}{9E9E9E}{E8E8E8}{FAFAFA}{616161}{464646}
\pressdefinecalloutpalette{success}{00C853}{CDEBD4}{E8F5E9}{2E7D32}{3D5141}
\pressdefinecalloutpalette{question}{FF6D00}{FFE5A8}{FFF8E1}{E65100}{564A38}
\pressdefinecalloutpalette{failure}{FF1744}{F7CCD6}{FCE4EC}{C62828}{584047}
\pressdefinecalloutpalette{danger}{D50000}{F7C9C9}{FFEBEE}{B71C1C}{594040}
\pressdefinecalloutpalette{bug}{F44336}{F5D0C8}{FBE9E7}{BF360C}{59423E}
\definecolor{CalloutDash}{HTML}{9EAAB2}
\providecommand{\coverheadingfont}{\sffamily}
\newcommand{\presscalloutbold}[1]{{\color{CalloutAccent\presscallouttype}\bfseries #1}}
\newcommand{\pressclipboardicon}{%
  \tikz[baseline=-0.5ex,x=1em,y=1em,line width=0.75pt]{%
    \draw[rounded corners=0.08em] (0.08,0.02) rectangle (0.82,0.90);%
    \draw[fill=CalloutTitlesummary,rounded corners=0.04em] (0.28,0.78) rectangle (0.62,1.00);%
    \draw (0.24,0.56) -- (0.66,0.56);%
    \draw (0.24,0.34) -- (0.66,0.34);%
  }%
}
\newcommand{\presscalloutglyphnote}{\ensuremath{\bullet}}
\newcommand{\presscalloutglyphsummary}{\pressclipboardicon}
\newcommand{\presscalloutglyphtip}{\textbf{*}}
\newcommand{\presscalloutglyphimportant}{\textbf{!}}
\newcommand{\presscalloutglyphwarning}{\textbf{!}}
\newcommand{\presscalloutglyphcaution}{\textbf{!}}
\newcommand{\presscalloutglyphabstract}{\textbf{=}}
\newcommand{\presscalloutglyphinfo}{\textbf{i}}
\newcommand{\presscalloutglyphtodo}{\tikz[baseline=-0.15ex]\draw[line width=0.65pt] (0,0) rectangle (0.55em,0.55em);}
\newcommand{\presscalloutglyphexample}{\textbf{E}}
\newcommand{\presscalloutglyphquote}{\textquotedblleft}
\newcommand{\presscalloutglyphsuccess}{\textbf{\ensuremath{\surd}}}
\newcommand{\presscalloutglyphquestion}{\textbf{?}}
\newcommand{\presscalloutglyphfailure}{\textbf{\ensuremath{\times}}}
\newcommand{\presscalloutglyphdanger}{\textbf{!}}
\newcommand{\presscalloutglyphbug}{\textbf{*}}
\newcommand{\presscallouticon}[1]{\makebox[1em][c]{\csname presscalloutglyph#1\endcsname}}
\newtcolorbox{presscallout}[2]{
  enhanced,
  breakable,
  colback=CalloutBody#1,
  colframe=CalloutFrame#1,
  colbacktitle=CalloutTitle#1,
  coltitle=CalloutAccent#1,
  boxrule=0.45pt,
  arc=1.8mm,
  outer arc=1.8mm,
  boxsep=0pt,
  left=3.5mm,
  right=3.5mm,
  top=3mm,
  bottom=3mm,
  toptitle=2.5mm,
  bottomtitle=2.5mm,
  title={\presscallouticon{#1}\hspace{0.65em}#2},
  fonttitle=\coverheadingfont\large\bfseries,
  titlerule=0.45pt,
  titlerule style={draw=CalloutDash,dash pattern=on 2pt off 1.5pt},
  before upper={\def\presscallouttype{#1}\color{CalloutInk#1}\let\textbf\presscalloutbold\setlength{\parskip}{0.8em}},
  before skip=1.2em,
  after skip=1.2em
}
`;
  const listingsContent = String.raw`\lstset{
  breaklines=true,
  breakatwhitespace=false,
  columns=fullflexible,
  keepspaces=true,
  basicstyle=\ttfamily\footnotesize,
  frame=single,
  framerule=0.3pt,
  rulecolor=\color[HTML]{D0D7DE},
  backgroundcolor=\color[HTML]{F6F8FA},
  xleftmargin=0.5em,
  xrightmargin=0.5em,
  aboveskip=0.8em,
  belowskip=0.8em
}
`;

  const titlingContent = "";
  const figureLabelContent = figureLabel
    ? `\\renewcommand{\\figurename}{${figureLabel}}\n`
    : "";

  let headingContent = "";
  const font = headingFont.trim();

  if (font && (engine === "xelatex" || engine === "lualatex")) {
    // Compute heading sizes as fixed ratios of the base font size so the
    // hierarchy scales correctly regardless of which font size the user picks.
    const h1 = (fontSize * 1.80).toFixed(2);
    const h2 = (fontSize * 1.55).toFixed(2);
    const h3 = (fontSize * 1.33).toFixed(2);
    // Line spacing = font size × 1.2 (standard baseline skip)
    const ls = (n: number) => (n * 1.2).toFixed(2);

    const sizeFormats = [
      `\\titleformat{\\section}{\\headingfont\\fontsize{${h1}pt}{${ls(+h1)}pt}\\selectfont\\bfseries}{\\thesection}{1em}{}`,
      `\\titleformat{\\subsection}[block]{}{}{0pt}{\\presssubsectionbox}`,
      `\\titleformat{\\subsubsection}{\\headingfont\\fontsize{${h3}pt}{${ls(+h3)}pt}\\selectfont\\bfseries}{\\thesubsubsection}{1em}{}`,
      `\\titleformat{\\paragraph}{\\headingfont\\normalsize\\bfseries}{\\theparagraph}{1em}{}`,
    ].join("\n");
    const subsectionBox = String.raw`
\DeclareRobustCommand{\pressheadingnumber}[1]{#1.\space}
\newcommand{\presscaptureheadingnumber}[1]{\gdef\presscapturedheadingnumber{#1}}
\newcommand{\presshideheadingnumber}[1]{}
\newcommand{\presssubsectionbox}[1]{%
  \begingroup
  \def\presscapturedheadingnumber{}%
  \begingroup
    \let\pressheadingnumber\presscaptureheadingnumber
    \setbox0=\hbox{#1}%
  \endgroup
  \let\pressheadingnumber\presshideheadingnumber
  \noindent\begin{tikzpicture}[baseline=(pressheadingtitle.base)]
    \node[
      fill=HeadingBlue,
      text=white,
      rounded corners=2mm,
      minimum width=15mm,
      minimum height=11mm,
      inner sep=0pt,
      font=\coverheadingfont\fontsize{${h2}pt}{${ls(+h2)}pt}\selectfont\bfseries
    ] (pressheadingnumber) {\presscapturedheadingnumber};
    \node[
      anchor=west,
      fill=HeadingTint,
      text=HeadingBlue,
      rounded corners=2mm,
      minimum height=11mm,
      text width=\dimexpr\linewidth-27mm\relax,
      align=left,
      inner xsep=4mm,
      inner ysep=2mm,
      font=\coverheadingfont\fontsize{${h2}pt}{${ls(+h2)}pt}\selectfont\bfseries\boldmath
    ] (pressheadingtitle) at ([xshift=3mm]pressheadingnumber.east) {#1};
  \end{tikzpicture}%
  \endgroup
}
\titlespacing*{\subsection}{0pt}{2.4ex plus 0.8ex minus 0.3ex}{1.5ex plus 0.4ex}
`;

    if (enableCjk) {
      // xeCJK is active: set both the Latin font (via fontspec) and the CJK
      // font (via xeCJK) so that mixed headings like "K 阵 CMB" render fully
      // in the chosen font instead of falling back to the body CJK font.
      headingContent = `
\\usepackage{titlesec}
\\newfontfamily\\headinglatinfont{${font}}
\\setCJKfamilyfont{headcjkfont}{${font}}
\\newcommand{\\headingfont}{\\headinglatinfont\\CJKfamily{headcjkfont}}
\\renewcommand{\\coverheadingfont}{\\headingfont}
${subsectionBox}
${sizeFormats}
`;
    } else {
      // No xeCJK: plain fontspec is sufficient.
      headingContent = `
\\usepackage{fontspec}
\\usepackage{titlesec}
\\newfontfamily\\headingfont{${font}}
\\renewcommand{\\coverheadingfont}{\\headingfont}
${subsectionBox}
${sizeFormats}
`;
    }
  }

  fs.writeFileSync(
    headerPath,
    coverContent + listingsContent + titlingContent + figureLabelContent + headingContent,
    "utf8"
  );
}

// === Error parsing ===

function parsePandocError(stderr: string, code: number | null): string {
  if (!stderr) return `Pandoc exited with code ${code}`;

  const lines = stderr.split("\n").filter((line) => line.trim());
  const latexErrorIndex = lines.findIndex((line) => /^! /.test(line.trim()));
  if (latexErrorIndex >= 0) {
    return lines
      .slice(latexErrorIndex, latexErrorIndex + 5)
      .join("\n")
      .substring(0, 800);
  }

  const errorPatterns = [
    /Package .* Error/,
    /LaTeX Error/,
    /error:/i,
    /not found/i,
    /failed/i,
    /cannot/i,
    /unable/i,
    /does not exist/i,
  ];

  for (const pattern of errorPatterns) {
    const errorLine = lines.find((line) => pattern.test(line));
    if (errorLine) return errorLine.trim();
  }

  return lines.slice(0, 3).join("; ").substring(0, 500);
}

// === Pandoc availability check ===

export async function checkPandocAvailable(
  pandocPath: string
): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(pandocPath, ["--version"], {
      shell: false,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
      },
    });

    let stdout = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        const versionMatch = stdout.match(/pandoc\s+(\d+\.\d+[.\d]*)/);
        resolve({
          available: true,
          version: versionMatch ? versionMatch[1] : "unknown",
        });
      } else {
        resolve({ available: false });
      }
    });

    child.on("error", () => {
      resolve({ available: false });
    });
  });
}
