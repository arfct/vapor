import { parseCriticRanges } from "./critic-markup";

export interface ParsedMark {
  from: number;
  to: number;
  type: string;
  attrs?: Record<string, unknown>;
}

export type CriticParseResult =
  | { ok: true; cleanText: string; marks: ParsedMark[] }
  | { ok: false; message: string };

export const UNSUPPORTED_SUBSTITUTION_MESSAGE =
  "Unsupported CriticMarkup: substitution ({~~old~>new~~}) is not supported. " +
  "Use separate deletion and addition instead: {--old--}{++new++}";

/**
 * Parse CriticMarkup text into clean text + mark ranges, as a result value
 * rather than an exception.
 *
 * Prefer this everywhere the input is agent- or user-supplied. Agent writes
 * arrive as arbitrary MCP arguments and travel through Yjs transactions that
 * cannot be rolled back, so a throw mid-transaction is both a lost error code
 * and a data-loss hazard — the caller needs to know the markdown is bad
 * *before* it touches the document.
 */
export function tryParseCriticMarkup(text: string): CriticParseResult {
  const ranges = parseCriticRanges(text);

  // Substitution has no equivalent in the mark model the editor uses.
  if (ranges.some((r) => r.type === "substitution")) {
    return { ok: false, message: UNSUPPORTED_SUBSTITUTION_MESSAGE };
  }

  const marks: ParsedMark[] = [];
  let cleanText = "";
  let cursor = 0;

  // Process ranges in order, stripping delimiters and recording marks
  for (const range of ranges) {
    // Append any text before this range
    cleanText += text.slice(cursor, range.start);

    const cleanStart = cleanText.length;

    switch (range.type) {
      case "addition":
        cleanText += range.content.addition;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticAddition",
        });
        break;
      case "deletion":
        cleanText += range.content.deletion;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticDeletion",
        });
        break;
      case "comment":
        cleanText += range.content.comment;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticComment",
        });
        break;
      case "highlight":
        cleanText += range.content.highlight;
        marks.push({
          from: cleanStart,
          to: cleanText.length,
          type: "criticHighlight",
        });
        break;
    }

    cursor = range.end;
  }

  // Append remaining text
  cleanText += text.slice(cursor);

  return { ok: true, cleanText, marks };
}

/**
 * Throwing wrapper around tryParseCriticMarkup, for the document-import path
 * (the agent's POST handler), where a throw is caught and turned into a 400
 * before anything has been written.
 *
 * Throws on unsupported substitution syntax ({~~old~>new~~}).
 */
export function parseCriticMarkupToContent(text: string): {
  cleanText: string;
  marks: ParsedMark[];
} {
  const result = tryParseCriticMarkup(text);
  if (!result.ok) throw new Error(result.message);
  return { cleanText: result.cleanText, marks: result.marks };
}
