import * as fs from "fs";
import * as path from "path";
import type { PageSize } from "./types";

interface ImageDimensions {
  width: number;
  height: number;
}

const PAGE_DIMENSIONS_MM: Record<PageSize, ImageDimensions> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  A3: { width: 297, height: 420 },
};

/** Calculate how much vertical page space a width-scaled local image needs. */
export function getImageNeedspaceFraction(
  markdownImage: string,
  pageSize: PageSize,
  pageMargin: string,
  widthFraction: number
): number {
  const dimensions = readMarkdownImageDimensions(markdownImage);
  if (!dimensions) return 0.5;

  const page = PAGE_DIMENSIONS_MM[pageSize];
  const parsedMargin = Number.parseFloat(pageMargin);
  const marginMm = Number.isFinite(parsedMargin) ? parsedMargin : 25;
  const contentWidth = Math.max(page.width - 2 * marginMm, 25);
  const contentHeight = Math.max(page.height - 2 * marginMm, 25);
  const scaledHeight =
    contentWidth * widthFraction * (dimensions.height / dimensions.width);
  // Reserve a small allowance for caption, paragraph spacing, and float glue.
  const requiredFraction = (Math.min(scaledHeight, contentHeight * 0.88) + 12) /
    contentHeight;

  return Math.min(Math.max(requiredFraction, 0.15), 0.94);
}

function readMarkdownImageDimensions(
  markdownImage: string
): ImageDimensions | undefined {
  const target = markdownImage.match(
    /\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/
  );
  const rawPath = target?.[1] ?? target?.[2];
  if (!rawPath) return undefined;

  let imagePath = rawPath;
  try {
    imagePath = decodeURIComponent(rawPath);
  } catch {
    // Keep the original path when it is not URI encoded.
  }

  if (!path.isAbsolute(imagePath) || !fs.existsSync(imagePath)) {
    return undefined;
  }

  try {
    const extension = path.extname(imagePath).toLowerCase();
    if (extension === ".png") return readPngDimensions(imagePath);
    if (extension === ".jpg" || extension === ".jpeg") {
      return readJpegDimensions(imagePath);
    }
    if (extension === ".svg") return readSvgDimensions(imagePath);
  } catch {
    return undefined;
  }

  return undefined;
}

function readPngDimensions(imagePath: string): ImageDimensions | undefined {
  const descriptor = fs.openSync(imagePath, "r");
  try {
    const header = Buffer.alloc(24);
    if (fs.readSync(descriptor, header, 0, header.length, 0) < header.length) {
      return undefined;
    }
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!header.subarray(0, 8).equals(pngSignature)) return undefined;
    return validDimensions(header.readUInt32BE(16), header.readUInt32BE(20));
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJpegDimensions(imagePath: string): ImageDimensions | undefined {
  const data = fs.readFileSync(imagePath);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = data.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 > data.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return validDimensions(
        data.readUInt16BE(offset + 7),
        data.readUInt16BE(offset + 5)
      );
    }
    offset += segmentLength + 2;
  }

  return undefined;
}

function readSvgDimensions(imagePath: string): ImageDimensions | undefined {
  const source = fs.readFileSync(imagePath, "utf8").slice(0, 8192);
  const viewBox = source.match(
    /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i
  );
  if (viewBox) return validDimensions(Number(viewBox[1]), Number(viewBox[2]));

  const width = source.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const height = source.match(/\bheight\s*=\s*["']([\d.]+)/i);
  return width && height
    ? validDimensions(Number(width[1]), Number(height[1]))
    : undefined;
}

function validDimensions(
  width: number,
  height: number
): ImageDimensions | undefined {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}
