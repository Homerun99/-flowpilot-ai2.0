import { readFile } from "node:fs/promises";

/**
 * Extract text content from a document file based on its type.
 *
 * Supported formats:
 *   - PDF (via pdf-parse)
 *   - DOCX (via mammoth)
 *   - CSV, TXT, ICS, MD — read directly as UTF-8 text
 *   - Fallback: attempt UTF-8 text read for unknown types
 *
 * @param filePath Absolute path to the file on disk
 * @param fileType File extension or MIME-adjacent type (e.g. "pdf", "docx", "csv")
 * @returns Extracted plain-text content
 */
export async function parseDocument(
  filePath: string,
  fileType: string,
): Promise<string> {
  const normalized = fileType.toLowerCase().trim();

  switch (normalized) {
    case "pdf":
      return parsePdf(filePath);

    case "docx":
    case "doc":
      return parseDocx(filePath);

    case "csv":
    case "txt":
    case "ics":
    case "md":
    case "markdown":
    case "text":
      return parseTextFile(filePath);

    default:
      // Fallback: try reading as UTF-8 text
      return parseTextFile(filePath);
  }
}

// ── PDF parser ────────────────────────────────────────────────────────────

async function parsePdf(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = await readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

// ── DOCX parser ───────────────────────────────────────────────────────────

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

// ── Plain-text / fallback parser ──────────────────────────────────────────

async function parseTextFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

// ── Helper: split text into overlapping chunks ────────────────────────────

export interface TextChunk {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

/**
 * Split long text into overlapping chunks suitable for embedding and search.
 *
 * @param text Full document text
 * @param maxChunkSize Maximum characters per chunk (default 500)
 * @param overlap Characters of overlap between consecutive chunks (default 50)
 */
export function chunkText(
  text: string,
  maxChunkSize = 500,
  overlap = 50,
): TextChunk[] {
  if (!text || text.length <= maxChunkSize) {
    return [{ index: 0, text, startChar: 0, endChar: text.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    // Try to break at a sentence or paragraph boundary
    const chunkText_ = text.slice(start, end);
    chunks.push({ index, text: chunkText_, startChar: start, endChar: end });
    index++;
    start = end - overlap;
  }

  return chunks;
}
