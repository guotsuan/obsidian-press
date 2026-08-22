export type TocTitle = "目录" | "Contents";

export function detectTocTitle(content: string): TocTitle {
  const mainContent = content
    // Metadata, code, equations, comments, and URL targets are not prose and
    // should not outweigh the language used by the document's main content.
    .replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?^---[ \t]*\r?$/m, "")
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^$\n]*\$/g, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, alias: string | undefined) => alias || target
    )
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<[^>]+>/g, "");
  const cjkCount =
    mainContent.match(
      /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu
    )?.length ?? 0;
  const latinCount = mainContent.match(/[A-Za-z]/g)?.length ?? 0;

  if (cjkCount === 0) return "Contents";
  if (latinCount === 0) return "目录";

  // A CJK character usually carries more lexical information than one Latin
  // letter. Weighting it 2:1 keeps Chinese technical reports with English
  // acronyms classified as Chinese while English-led bilingual files remain
  // English.
  return cjkCount * 2 >= latinCount ? "目录" : "Contents";
}
