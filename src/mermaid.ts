import * as fs from "fs";
import * as path from "path";
import { runCommand, checkCommandExists } from "./utils";

/**
 * Render a Mermaid diagram to SVG using mmdc (mermaid-cli).
 * Returns the SVG file path, or null if mmdc is not available.
 */
export async function renderMermaidBlock(
  code: string,
  theme: string,
  tmpDir: string,
  index: number,
  mermaidPath = "mmdc"
): Promise<string | null> {
  // Check if mmdc is available
  const mmdcAvailable = await checkCommandExists(shellQuote(mermaidPath));
  if (!mmdcAvailable) {
    console.warn(
      `Press PDF Export: Mermaid CLI not found at ${mermaidPath}, skipping Mermaid rendering`
    );
    return null;
  }

  const inputFile = path.join(tmpDir, `mermaid-input-${index}.mmd`);
  const outputFile = path.join(tmpDir, `mermaid-output-${index}.svg`);
  const configFile = path.join(tmpDir, `mermaid-config-${index}.json`);

  try {
    // Write mermaid source to temp file
    fs.writeFileSync(inputFile, code, "utf8");

    // Mermaid uses HTML foreignObject labels by default. Many PDF/SVG
    // converters (including common Pandoc pipelines) discard foreignObject,
    // leaving visible node shapes with no text. Native SVG text labels work
    // across browsers, LaTeX engines, librsvg, and ImageMagick.
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        fontFamily:
          'Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      }),
      "utf8"
    );

    // Run mmdc via login shell
    const cmd = `${shellQuote(mermaidPath)} -i ${shellQuote(inputFile)} -o ${shellQuote(outputFile)} -c ${shellQuote(configFile)} -t ${shellQuote(theme)} -b transparent --quiet`;
    const { code: exitCode, stderr } = await runCommand(cmd, {
      timeout: 30000,
    });

    // Verify output exists
    if (exitCode === 0 && fs.existsSync(outputFile)) {
      return outputFile;
    }

    console.warn("Press PDF Export: Mermaid rendering failed:", stderr);
    return null;
  } catch (err) {
    console.error("Press PDF Export: Mermaid rendering error:", err);
    return null;
  } finally {
    // Clean up input and config files
    for (const tempFile of [inputFile, configFile]) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/** Quote a single shell argument for the login-shell command runner. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Clean up SVG output files from tmp directory
 */
export function cleanupMermaidFiles(svgPaths: string[]): void {
  for (const svgPath of svgPaths) {
    try {
      if (fs.existsSync(svgPath)) {
        fs.unlinkSync(svgPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
