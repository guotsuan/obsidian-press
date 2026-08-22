import { App, TFile } from "obsidian";
import * as path from "path";
import { RenderResult, CalloutType, PageSize } from "./types";
import { resolveAttachmentPath, getTmpDir } from "./utils";
import { renderMermaidBlock } from "./mermaid";
import { getImageNeedspaceFraction } from "./image-layout";

const CALLOUT_TYPES: CalloutType[] = [
  "note",
  "summary",
  "tip",
  "important",
  "warning",
  "caution",
  "abstract",
  "info",
  "todo",
  "example",
  "quote",
  "success",
  "question",
  "failure",
  "danger",
  "bug",
];

const CALLOUT_ICONS: Record<string, string> = {
  note: "\u{1F4DD}",
  summary: "\u{1F4CB}",
  tip: "\u{1F4A1}",
  important: "\u{2757}",
  warning: "\u{26A0}\u{FE0F}",
  caution: "\u{26A0}\u{FE0F}",
  abstract: "\u{1F4CB}",
  info: "\u{2139}\u{FE0F}",
  todo: "\u{2611}",
  example: "\u{1F4DA}",
  quote: "\u{275D}",
  success: "\u{2705}",
  question: "\u{2753}",
  failure: "\u{274C}",
  danger: "\u{1F6A8}",
  bug: "\u{1F41B}",
};

const CALLOUT_ALIASES: Record<string, CalloutType> = {
  tldr: "summary",
  hint: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  fail: "failure",
  missing: "failure",
  error: "danger",
  attention: "warning",
  cite: "quote",
};

function isCalloutType(value: string): value is CalloutType {
  return CALLOUT_TYPES.some((type) => type === value);
}

/**
 * Full preprocessing pipeline: Obsidian Markdown → Pandoc-compatible Markdown
 */
export async function renderToPandoc(
  content: string,
  file: TFile,
  app: App,
  mermaidPath: string,
  mermaidTheme: string,
  pageSize: PageSize = "A4",
  pageMargin = "25",
  useLatexH2Layout = false,
  useLatexCallouts = false
): Promise<RenderResult> {
  const tmpDir = getTmpDir(app);
  const tempFiles: string[] = [];

  // Step 1: Strip YAML frontmatter and collect metadata for the title block.
  // Title/author/version are returned to the caller (exporter) which passes
  // them to pandoc as --metadata args; they are NOT injected as headings.
  const fm = stripFrontmatter(content);
  let rendered = fm.content;
  let figureLabel: RenderResult["figureLabel"];

  rendered = formatFlattenedCodeBlocks(rendered);

  // Step 2: Pre-render Mermaid blocks before protecting ordinary code fences
  rendered = await convertMermaidBlocks(
    rendered,
    mermaidPath,
    mermaidTheme,
    tmpDir,
    tempFiles
  );

  // Step 3: Protect code blocks/spans from Obsidian syntax conversions
  const protectedCode = protectCodeSegments(rendered);
  rendered = protectedCode.content;

  // Pandoc's DOCX math writer cannot convert deprecated TeX font switches
  // such as {\rm text}; normalize them to modern math commands before the
  // document reaches any output engine. Code examples are already protected.
  rendered = normalizeLegacyMathCommands(rendered);

  // Step 4: Convert callouts
  rendered = convertCallouts(rendered, useLatexCallouts);

  // Step 5: Resolve images before wikilinks. Otherwise ![[img.png]] is
  // partially consumed by the generic [[wikilink]] conversion.
  rendered = convertEmbeds(rendered, file, app);
  rendered = resolveMarkdownImages(rendered, file, app);

  // Step 6: Inline embedded notes ![[other-note]] (limited depth)
  rendered = await inlineNoteEmbeds(rendered, file, app, 0, 5);

  // H2 headings are drawn by LaTeX as a number tile plus a title bar. Extract
  // an explicit Markdown number here instead of parsing Pandoc's generated
  // \texorpdfstring in LaTeX (which breaks as soon as the title contains math).
  // Run after note inlining so headings from embedded notes are covered too.
  if (useLatexH2Layout) {
    rendered = markH2HeadingNumbers(rendered);
  }

  // Step 7: Convert remaining wikilinks to standard links
  rendered = convertWikilinks(rendered, file, app);

  // Step 8: Convert ==highlight== → <mark>highlight</mark>
  rendered = convertHighlights(rendered);

  // Step 9: Convert ^sup^ and ~~sub~~
  rendered = convertSupSub(rendered);

  // Step 10: Strip %%comments%%
  rendered = stripComments(rendered);

  // Step 11: Convert Obsidian-style images with size ![[img.png|200]]
  rendered = convertImageSizes(rendered);

  // Step 12: Only images followed by an explicit Chinese/English figure line
  // receive a caption (and therefore Pandoc numbering). Other image alts are
  // cleared so standalone images remain unnumbered.
  const captionResult = processImageCaptions(rendered);
  rendered = captionResult.content;
  figureLabel = captionResult.figureLabel;
  rendered = applyDefaultImageWidths(rendered, pageSize, pageMargin);

  // Step 13: Restore protected code blocks/spans for Pandoc highlighting
  rendered = restoreCodeSegments(rendered, protectedCode.segments);

  return {
    content: rendered,
    tempFiles,
    title: fm.title,
    subtitle: fm.subtitle,
    category: fm.category,
    tags: fm.tags,
    keyword: fm.keyword,
    author: fm.author,
    institution: fm.institution,
    version: fm.version,
    date: fm.date,
    modified: fm.modified,
    figureLabel,
  };
}

export function normalizeLegacyMathCommands(content: string): string {
  const commands: Record<string, string> = {
    rm: "mathrm",
    bf: "mathbf",
    it: "mathit",
    sf: "mathsf",
    tt: "mathtt",
  };
  const normalizeMath = (math: string): string =>
    math.replace(
      /\{\\(rm|bf|it|sf|tt)\s+/g,
      (_match, command: string) => `\\${commands[command]}{`
    );

  // Process display math first, then inline math. The second pass is
  // idempotent for already-normalized display blocks.
  return content
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) =>
      `$$${normalizeMath(math)}$$`
    )
    .replace(/\$([^$\n]+)\$/g, (_match, math: string) =>
      `$${normalizeMath(math)}$`
    );
}

/**
 * Preserve an explicit H2 number as a raw LaTeX marker for the PDF heading
 * renderer. Protected code blocks have already been replaced with tokens, so
 * Markdown examples inside code fences are not modified.
 */
export function markH2HeadingNumbers(content: string): string {
  return content.replace(
    /^(##)[ \t]+(\d+(?:\.\d+)*)(?:[.．、][ \t]*|[ \t]+)(\S.*)$/gm,
    (_match, hashes: string, number: string, title: string) =>
      hashes + " \\pressheadingnumber{" + number + "}" + title
  );
}

export function formatFlattenedCodeBlocks(content: string): string {
  return content.replace(
    /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm,
    (match, fence: string, info: string, code: string) => {
      const language = info.trim().split(/\s+/)[0]?.toLowerCase() || "";
      if (!shouldFormatFlattenedCode(language, code)) {
        return match;
      }

      const formatted = formatJavaScriptLikeCode(code);
      return `${fence}${info}\n${formatted}\n${fence}`;
    }
  );
}

function shouldFormatFlattenedCode(language: string, code: string): boolean {
  const supportedLanguages = new Set([
    "",
    "js",
    "javascript",
    "jsx",
    "ts",
    "typescript",
    "tsx",
    "php",
  ]);
  if (!supportedLanguages.has(language)) {
    return false;
  }

  const trimmed = code.trim();
  if (trimmed.length < 160) {
    return false;
  }

  const nonEmptyLines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (nonEmptyLines.length > 2) {
    return false;
  }

  return /[{};]/.test(trimmed) && /\b(const|let|var|function|class|async|while|if|return|await|new)\b/.test(trimmed);
}

function formatJavaScriptLikeCode(code: string): string {
  const { text, literals } = protectStringLiterals(code.trim());

  let formatted = text
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\}\s*else\s*\{/g, "}\nelse {")
    .replace(/\}\s*catch\s*\(/g, "}\ncatch (")
    .replace(/\}\s*finally\s*\{/g, "}\nfinally {")
    .replace(/\s*\{\s*/g, " {\n")
    .replace(/;\s*/g, ";\n")
    .replace(/,\s*/g, ",\n")
    .replace(/\s*\}\s*/g, "\n}\n")
    .replace(/\)\s*(?=(?:async\s+)?(?:function|class|const|let|var|if|for|while|return|await|new|this\.))/g, ")\n")
    .replace(/\n{2,}/g, "\n");

  formatted = restoreStringLiterals(formatted, literals);
  return indentFormattedCode(formatted);
}

function protectStringLiterals(code: string): { text: string; literals: string[] } {
  const literals: string[] = [];
  let text = "";
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    if (char !== "'" && char !== '"' && char !== "`") {
      text += char;
      i++;
      continue;
    }

    const quote = char;
    let literal = char;
    i++;

    while (i < code.length) {
      const next = code[i];
      literal += next;
      i++;

      if (next === "\\") {
        if (i < code.length) {
          literal += code[i];
          i++;
        }
        continue;
      }

      if (next === quote) {
        break;
      }
    }

    const token = `__OBSIDIAN_PRESS_LITERAL_${literals.length}__`;
    literals.push(literal);
    text += token;
  }

  return { text, literals };
}

function restoreStringLiterals(text: string, literals: string[]): string {
  return literals.reduce(
    (result, literal, index) =>
      result.split(`__OBSIDIAN_PRESS_LITERAL_${index}__`).join(literal),
    text
  );
}

function indentFormattedCode(code: string): string {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const output: string[] = [];
  let level = 0;

  for (const line of lines) {
    if (line.startsWith("}") || line.startsWith("]") || line.startsWith(")")) {
      level = Math.max(0, level - 1);
    }

    output.push(`${"  ".repeat(level)}${line}`);

    const opens = countCharacters(line, "{[(");
    const closes = countCharacters(line, "}])");
    level = Math.max(0, level + opens - closes);
  }

  return output.join("\n");
}

function countCharacters(value: string, characters: string): number {
  let count = 0;
  for (const char of value) {
    if (characters.includes(char)) {
      count++;
    }
  }
  return count;
}

// === Code protection ===

interface ProtectedCodeSegments {
  content: string;
  segments: Map<string, string>;
}

function protectCodeSegments(content: string): ProtectedCodeSegments {
  const segments = new Map<string, string>();
  let index = 0;

  const store = (value: string): string => {
    const token = `OBSIDIAN_PRESS_CODE_${index++}`;
    segments.set(token, value);
    return token;
  };

  let result = content.replace(
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm,
    (match) => store(match)
  );

  result = result.replace(/(`+)([\s\S]*?[^`])\1/g, (match) => store(match));

  return { content: result, segments };
}

function restoreCodeSegments(
  content: string,
  segments: Map<string, string>
): string {
  let result = content;
  for (const [token, value] of segments) {
    result = result.split(token).join(value);
  }
  return result;
}

// === Step 1: YAML Frontmatter ===

interface FrontmatterResult {
  content: string;
  title?: string;
  subtitle?: string;
  category?: string;
  tags?: string[];
  keyword?: string;
  author?: string;
  institution?: string;
  version?: string;
  date?: string;
  modified?: string;
}

function stripFrontmatter(content: string): FrontmatterResult {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
  const match = content.match(frontmatterRegex);

  const defaults = {
    category: "Note",
    keyword: "Report",
    institution: "中国科学院上海天文台",
  };

  if (!match) return { content, ...defaults };

  const yaml = match[1];
  const rest = content.slice(match[0].length);

  const extract = (key: string): string | undefined => {
    const m = yaml.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    const value = m?.[1].replace(/^["']|["']$/g, "").trim();
    return value || undefined;
  };

  const extractTags = (): string[] | undefined => {
    // Use horizontal whitespace here: `\s` would consume the newline after
    // `tags:` and incorrectly treat the first list item as an inline value.
    const inlineMatch = yaml.match(/^tags:[ \t]*(.*)$/m);
    if (!inlineMatch) return undefined;

    const inlineValue = inlineMatch[1].trim();
    if (inlineValue) {
      const unwrapped = inlineValue.replace(/^\[|\]$/g, "");
      const values = unwrapped.includes(",")
        ? unwrapped.split(",")
        : [unwrapped];
      const tags = values.map(cleanYamlValue).filter(Boolean);
      return tags.length ? tags : undefined;
    }

    const blockMatch = yaml.match(
      /^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]*[^\r\n]*(?:\r?\n|$))+)/m
    );
    if (!blockMatch) return undefined;

    const tags = blockMatch[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*-\s*/, ""))
      .map(cleanYamlValue)
      .filter(Boolean);
    return tags.length ? tags : undefined;
  };

  return {
    content: rest,
    title: extract("title"),
    subtitle: extract("subtitle"),
    category: extract("category") || defaults.category,
    tags: extractTags(),
    keyword: extract("keyword") || defaults.keyword,
    author: extract("author"),
    institution: extract("institution") || defaults.institution,
    version: extract("version"),
    date: extract("date"),
    modified: extract("modified"),
  };
}

function cleanYamlValue(value: string): string {
  return value
    .trim()
    .replace(/^-\s*/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

// === Step 2: Callouts ===

function convertCallouts(content: string, useLatex = false): string {
  // Match callout blocks: > [!type] Title\n> content...
  const calloutRegex =
    /^(>\s*\[!([a-zA-Z]+)\](\+|-)?\s*(.*)?\n(?:>\s*.*\n?)*)/gm;

  return content.replace(
    calloutRegex,
    (
      match: string,
      _full: string,
      type: string,
      _collapse: string | undefined,
      title: string | undefined
    ) => {
      const rawType = type.toLowerCase();
      const cssType =
        CALLOUT_ALIASES[rawType] || (isCalloutType(rawType) ? rawType : "note");
      const icon = CALLOUT_ICONS[cssType] || "\u{1F4DD}";
      const displayTitle = (title || cssType).trim();

      // Strip leading > from each line
      const lines = match.split("\n");
      const bodyLines = lines
        .map((line: string) => line.replace(/^>\s?/, ""))
        .filter((_line: string, i: number) => {
          // Remove the first line (the [!type] line)
          if (i === 0) return false;
          return true;
        });

      const body = bodyLines.join("\n").trim();

      if (useLatex) {
        const pandocTitle = escapePandocAttribute(displayTitle);
        return `::: {.callout .callout-${cssType} callout-type="${cssType}" callout-title="${pandocTitle}"}\n\n${body}\n\n:::`;
      }

      return `<div class="callout callout-${cssType}">\n<div class="callout-title">\n${icon} ${displayTitle}\n</div>\n<div class="callout-body">\n\n${body}\n\n</div>\n</div>`;
    }
  );
}

function escapePandocAttribute(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// === Step 3: WikiLinks ===

function convertWikilinks(content: string, file: TFile, app: App): string {
  // [[target]] or [[target|alias]]
  return content.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g,
    (
      match: string,
      target: string,
      alias: string | undefined,
      offset: number
    ) => {
      // Image and note embeds use ![[...]] and are handled separately. Keep
      // unresolved embeds intact rather than turning them into literal text.
      if (offset > 0 && content[offset - 1] === "!") {
        return match;
      }

      const displayText = alias || target;

      // Try to resolve as note file
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(
        target,
        file.path
      );
      if (resolvedFile) {
        const relativePath = getRelativePath(file.path, resolvedFile.path);
        return `[${displayText}](${relativePath})`;
      }

      // Fallback: create link with .md extension
      return `[${displayText}](${target}.md)`;
    }
  );
}

// === Step 4: Embed Images ===

function convertEmbeds(
  content: string,
  file: TFile,
  app: App
): string {
  // ![[image.png]] or ![[image.png|size]]
  const embedRegex = /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/g;

  let result = content;
  let match: RegExpExecArray | null;

  while ((match = embedRegex.exec(content)) !== null) {
    const [fullMatch, src, size] = match;

    // Check if it's an image
    if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(src)) {
      const absPath = resolveAttachmentPath(src, file, app);
      const sizeAttr = size ? ` width="${size}"` : "";
      const replacement = `![${src}](<${absPath}>)${sizeAttr ? "{width=" + size + "}" : ""}`;
      result = result.replace(fullMatch, replacement);
    }
  }

  return result;
}

/**
 * Resolve local images written with standard Markdown syntax relative to the
 * source note, the vault root, or Obsidian's attachment directory. Pandoc
 * reads a temporary Markdown file, so unresolved relative paths would
 * otherwise be looked up from the plugin temp directory.
 */
function resolveMarkdownImages(
  content: string,
  file: TFile,
  app: App
): string {
  const imageRegex =
    /!\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\n]*?)\s*\)(\{[^}\n]*\})?/g;

  return content.replace(
    imageRegex,
    (fullMatch, alt: string, rawTarget: string, attributes = "") => {
      const parsed = splitMarkdownImageTarget(rawTarget);
      const target = stripMarkdownUrlDelimiters(parsed.destination);

      if (
        !target ||
        path.isAbsolute(target) ||
        /^(?:https?:|data:|file:|#)/i.test(target)
      ) {
        return fullMatch;
      }

      const resolvedPath = resolveAttachmentPath(target, file, app);
      if (!path.isAbsolute(resolvedPath)) {
        return fullMatch;
      }

      return `![${alt}](<${resolvedPath}>${parsed.title})${attributes}`;
    }
  );
}

function splitMarkdownImageTarget(rawTarget: string): {
  destination: string;
  title: string;
} {
  const trimmed = rawTarget.trim();
  const titleMatch = trimmed.match(/^(.*?)(\s+(?:"[^"\n]*"|'[^'\n]*'))$/);
  if (!titleMatch) {
    return { destination: trimmed, title: "" };
  }

  return {
    destination: titleMatch[1].trim(),
    title: titleMatch[2],
  };
}

function stripMarkdownUrlDelimiters(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

// === Step 5: Inline Note Embeds ===

async function inlineNoteEmbeds(
  content: string,
  currentFile: TFile,
  app: App,
  depth: number,
  maxDepth: number
): Promise<string> {
  if (depth >= maxDepth) return content;

  // ![[note-name]] (not images)
  const embedRegex = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
  let result = content;
  let match: RegExpExecArray | null;

  const contentSnapshot = result;
  while ((match = embedRegex.exec(contentSnapshot)) !== null) {
    const [fullMatch, target] = match;

    // Skip images (handled in step 4)
    if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(target)) {
      continue;
    }

    // Resolve the note
    const resolvedFile = app.metadataCache.getFirstLinkpathDest(
      target,
      currentFile.path
    );
    if (resolvedFile instanceof TFile && resolvedFile.extension === "md") {
      const embedContent = await app.vault.read(resolvedFile);

      // Resolve images against the embedded note before inserting its content
      // into the parent note, preserving the embedded note's path context.
      let processed = convertEmbeds(embedContent, resolvedFile, app);
      processed = resolveMarkdownImages(processed, resolvedFile, app);

      // Recursively process nested note embeds.
      processed = await inlineNoteEmbeds(
        processed,
        resolvedFile,
        app,
        depth + 1,
        maxDepth
      );

      result = result.replace(
        fullMatch,
        `\n\n<!-- Embedded: ${target} -->\n\n${processed}\n\n<!-- End embed: ${target} -->\n\n`
      );
    }
  }

  return result;
}

// === Step 6: Highlights ===

function convertHighlights(content: string): string {
  // ==text== → <mark>text</mark>
  return content.replace(/==([^=]+)==/g, "<mark>$1</mark>");
}

// === Step 7: Superscript / Subscript ===

function convertSupSub(content: string): string {
  // ^text^ and ~text~ are passed through as-is; pandoc handles them via
  // +superscript and +subscript extensions, which produce correct LaTeX
  // (\textsuperscript / \textsubscript) instead of raw HTML tags.
  return content;
}

// === Step 8: Strip Comments ===

function stripComments(content: string): string {
  // %%comment%% → (removed)
  return content.replace(/%%[\s\S]*?%%/g, "");
}

// === Step 9: Image Sizes ===

function convertImageSizes(content: string): string {
  // ![alt|size](url) → ![alt](url){width=size}
  // Already handled in convertEmbeds for ![[ ]] syntax
  // Handle standard markdown image with Obsidian size: ![alt|200](url)
  return content.replace(
    /!\[([^\]]*?)\|(\d+)\]\(([^)]+)\)/g,
    (_match, alt, size, url) => {
      return `![${alt}](${url}){width=${size}}`;
    }
  );
}

/**
 * Convert explicit Chinese/English figure lines into Pandoc implicit-figure
 * captions. Images without such a line have their alt cleared, preventing
 * Pandoc from numbering them as figures.
 *
 *   ![alt](image.png)
 *   *图 1：Caption text*
 *   *Figure 1: Caption text*
 *
 * Pandoc supplies the figure number, so only the text after the first Chinese
 * or ASCII colon is used as the image label. The standalone italic line is
 * removed to avoid rendering the caption twice.
 */
function processImageCaptions(content: string): {
  content: string;
  figureLabel: RenderResult["figureLabel"];
} {
  const imageRegex =
    /!\[([^\]]*)\](\(\s*(?:<[^>\n]+>|[^)\n]*?)\s*\))(\{[^}\n]*\})?/g;
  const followingCaptionRegex =
    /^[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*\*((?:图|Figure)\s*[^\n]+)\*[ \t]*(?=\r?\n|$)/i;

  let result = "";
  let cursor = 0;
  let figureLabel: RenderResult["figureLabel"];
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(content)) !== null) {
    const [_fullMatch, alt, destination, rawAttributes = ""] = match;
    result += content.slice(cursor, match.index);

    const afterImage = content.slice(imageRegex.lastIndex);
    const followingCaption = afterImage.match(followingCaptionRegex);
    const parsedCaption = followingCaption
      ? parseFigureCaption(followingCaption[1])
      : null;
    const hasExplicitCaptionMarker = rawAttributes.includes(
      ".press-explicit-caption"
    );
    const attributes = removeExplicitCaptionMarker(rawAttributes);

    if (parsedCaption && followingCaption) {
      const caption = escapeMarkdownImageAlt(parsedCaption.caption);
      result += `![${caption}]${destination}${attributes}`;
      figureLabel ??= parsedCaption.label;
      cursor = imageRegex.lastIndex + followingCaption[0].length;
      imageRegex.lastIndex = cursor;
    } else if (hasExplicitCaptionMarker && alt) {
      result += `![${alt}]${destination}${attributes}`;
      figureLabel ??= containsCjkText(alt) ? "图" : "Figure";
      cursor = imageRegex.lastIndex;
    } else {
      result += `![]${destination}${attributes}`;
      cursor = imageRegex.lastIndex;
    }

  }

  result += content.slice(cursor);
  return { content: result, figureLabel };
}

function parseFigureCaption(
  line: string
): { caption: string; label: "图" | "Figure" } | null {
  const identifier = "[0-9A-Za-z一二三四五六七八九十百零〇IVXLCDMivxlcdm-]+";
  const chinese = line
    .trim()
    .match(new RegExp(`^图\\s*${identifier}\\s*[：:]\\s*(.+)$`, "u"));
  if (chinese?.[1]?.trim()) {
    return { caption: chinese[1].trim(), label: "图" };
  }

  const english = line
    .trim()
    .match(new RegExp(`^Figure\\s+${identifier}\\s*[：:]\\s*(.+)$`, "iu"));
  if (english?.[1]?.trim()) {
    return { caption: english[1].trim(), label: "Figure" };
  }

  return null;
}

function removeExplicitCaptionMarker(attributes: string): string {
  if (!attributes) return "";
  const remaining = attributes
    .slice(1, -1)
    .split(/\s+/)
    .filter((attribute) => attribute !== ".press-explicit-caption")
    .join(" ");
  return remaining ? `{${remaining}}` : "";
}

function containsCjkText(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

/** Add a portable Pandoc width unless the author supplied one explicitly. */
function applyDefaultImageWidths(
  content: string,
  pageSize: PageSize,
  pageMargin: string
): string {
  const markdownImageRegex =
    /(!\[[^\]]*\]\(\s*(?:<[^>\n]+>|[^)\n]*?)\s*\))(\{[^}\n]*\})?/g;
  const maxPixelWidth = getDefaultImagePixelWidth(pageSize, pageMargin);

  return content.replace(
    markdownImageRegex,
    (_fullMatch, image: string, attributes: string | undefined) => {
      if (attributes?.includes(".press-mermaid")) {
        return `${image}${removeImageMarker(attributes, ".press-mermaid")}`;
      }
      if (!attributes) {
        return addLatexLargeImageGuard(
          `${image}{width=95%}`,
          pageSize,
          pageMargin,
          0.95
        );
      }

      const attributeBody = attributes.slice(1, -1);
      const widthMatch = attributeBody.match(
        /(?:^|\s)width\s*=\s*(?:"(\d+(?:\.\d+)?)(?:px)?"|(\d+(?:\.\d+)?)(?:px)?)(?=\s|$)/i
      );
      if (widthMatch) {
        const numericWidth = Number(widthMatch[1] || widthMatch[2]);
        if (numericWidth > maxPixelWidth) {
          const normalized = attributeBody
            .replace(widthMatch[0], `${widthMatch[0].startsWith(" ") ? " " : ""}width=95%`)
            .trim();
          return addLatexLargeImageGuard(
            `${image}{${normalized}}`,
            pageSize,
            pageMargin,
            0.95
          );
        }
        return `${image}${attributes}`;
      }
      if (/(?:^|\s)width\s*=/.test(attributeBody)) {
        const percentWidth = attributeBody.match(
          /(?:^|\s)width\s*=\s*"?(\d+(?:\.\d+)?)%"?(?=\s|$)/i
        );
        return percentWidth && Number(percentWidth[1]) >= 70
          ? addLatexLargeImageGuard(
              `${image}${attributes}`,
              pageSize,
              pageMargin,
              Number(percentWidth[1]) / 100
            )
          : `${image}${attributes}`;
      }

      const existing = attributeBody.trim();
      return addLatexLargeImageGuard(
        `${image}{${existing ? existing + " " : ""}width=95%}`,
        pageSize,
        pageMargin,
        0.95
      );
    }
  );
}

/**
 * Ensure a page has enough vertical room before TeX encounters a large image.
 * Raw LaTeX is ignored by non-LaTeX writers, so DOCX/HTML output is unchanged.
 */
function addLatexLargeImageGuard(
  image: string,
  pageSize: PageSize,
  pageMargin: string,
  widthFraction: number
): string {
  const required = getImageNeedspaceFraction(
    image,
    pageSize,
    pageMargin,
    widthFraction
  ).toFixed(3);
  return `\n\n\`\`\`{=latex}\n\\Needspace{${required}\\textheight}\n\`\`\`\n\n${image}`;
}

function getDefaultImagePixelWidth(
  pageSize: PageSize,
  pageMargin: string
): number {
  const pageWidthsMm: Record<PageSize, number> = {
    A4: 210,
    Letter: 215.9,
    Legal: 215.9,
    A3: 297,
  };
  const parsedMargin = Number.parseFloat(pageMargin);
  const marginMm = Number.isFinite(parsedMargin) ? parsedMargin : 25;
  const contentWidthMm = Math.max(pageWidthsMm[pageSize] - 2 * marginMm, 25);
  return (contentWidthMm / 25.4) * 96 * 0.95;
}

function removeImageMarker(attributes: string, marker: string): string {
  const remaining = attributes
    .slice(1, -1)
    .split(/\s+/)
    .filter((attribute) => attribute && attribute !== marker)
    .join(" ");
  return remaining ? `{${remaining}}` : "";
}

// === Step 10: Mermaid Blocks ===

async function convertMermaidBlocks(
  content: string,
  mermaidPath: string,
  mermaidTheme: string,
  tmpDir: string,
  tempFiles: string[]
): Promise<string> {
  // ```mermaid\n...\n```
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;

  let result = content;
  let match: RegExpExecArray | null;
  let index = 0;

  const contentSnapshot = content;
  while ((match = mermaidRegex.exec(contentSnapshot)) !== null) {
    const [fullMatch, code] = match;
    index++;

    try {
      const mermaid = extractMermaidCaption(code);
      const svgPath = await renderMermaidBlock(
        mermaid.code,
        mermaidTheme,
        tmpDir,
        index,
        mermaidPath
      );

      if (svgPath) {
        tempFiles.push(svgPath);
        const caption =
          mermaid.caption === undefined
            ? `Mermaid Diagram ${index}`
            : mermaid.caption;
        const markers = [
          ".press-mermaid",
          ...(mermaid.caption === undefined
            ? []
            : [".press-explicit-caption"]),
        ].join(" ");
        result = result.replace(
          fullMatch,
          `![${escapeMarkdownImageAlt(caption)}](${svgPath}){${markers}}`
        );
      } else {
        // Fallback: keep as code block
        result = result.replace(
          fullMatch,
          "```mermaid\n" + code + "```"
        );
      }
    } catch {
      // Keep as code block on error
    }
  }

  return result;
}

/**
 * Read an optional `%% caption: ...` comment from a Mermaid block.
 * The metadata line must not be passed to Mermaid itself because its purpose
 * is to control the surrounding Pandoc figure rather than the diagram.
 */
function extractMermaidCaption(code: string): {
  code: string;
  caption: string | undefined;
} {
  let caption: string | undefined;
  const diagramLines: string[] = [];

  for (const line of code.split("\n")) {
    const match = line.match(/^\s*%%\s*caption\s*:\s*(.*?)\s*$/i);
    if (caption === undefined && match) {
      caption = match[1].trim();
    } else {
      diagramLines.push(line);
    }
  }

  return { code: diagramLines.join("\n").trim(), caption };
}

/**
 * Escape Markdown brackets outside math while preserving LaTeX commands.
 * Backslashes inside `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` must
 * reach Pandoc unchanged or commands such as `\alpha` become invalid.
 */
function escapeMarkdownImageAlt(caption: string): string {
  let result = "";
  let mathEnd: "$" | "$$" | "\\)" | "\\]" | null = null;

  for (let index = 0; index < caption.length;) {
    if (mathEnd) {
      if (caption.startsWith(mathEnd, index)) {
        result += mathEnd;
        index += mathEnd.length;
        mathEnd = null;
      } else {
        result += caption[index];
        index++;
      }
      continue;
    }

    if (caption.startsWith("$$", index)) {
      result += "$$";
      index += 2;
      mathEnd = "$$";
    } else if (caption[index] === "$") {
      result += "$";
      index++;
      mathEnd = "$";
    } else if (caption.startsWith("\\(", index)) {
      result += "\\(";
      index += 2;
      mathEnd = "\\)";
    } else if (caption.startsWith("\\[", index)) {
      result += "\\[";
      index += 2;
      mathEnd = "\\]";
    } else if (caption[index] === "[" || caption[index] === "]") {
      result += `\\${caption[index]}`;
      index++;
    } else {
      result += caption[index];
      index++;
    }
  }

  return result;
}

// === Helpers ===

function getRelativePath(from: string, to: string): string {
  const fromDir = from.substring(0, from.lastIndexOf("/"));
  let relative = "";
  const fromParts = fromDir.split("/");
  const toParts = to.split("/");

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Go up from current directory
  for (let i = commonLength; i < fromParts.length; i++) {
    relative += "../";
  }

  // Go down to target
  for (let i = commonLength; i < toParts.length; i++) {
    relative += toParts[i];
    if (i < toParts.length - 1) relative += "/";
  }

  return relative || to;
}
