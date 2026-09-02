import { blockHash } from "~/shared/agent-protocol";

export interface PlaceholderPreset {
  title: string;
  body: string;
}

/**
 * Title / body placeholder pairs for an empty document: quotations that
 * split cleanly into a first line and a follow-on. Chosen per document by
 * id, so a document keeps its pair across reloads and collaborators see
 * the same one.
 */
export const PLACEHOLDER_PRESETS: readonly PlaceholderPreset[] = [
  { title: "Time is an illusion.", body: "Lunchtime doubly so." },
  { title: "It was the best of times,", body: "it was the worst of times." },
  { title: "The past is a foreign country:", body: "they do things differently there." },
  { title: "We are all in the gutter,", body: "but some of us are looking at the stars." },
  { title: "Not all those who wander", body: "are lost." },
  { title: "Whereof one cannot speak,", body: "thereof one must be silent." },
  { title: "I have made this longer than usual", body: "because I have not had time to make it shorter." },
  { title: "Everything should be made as simple as possible,", body: "but not simpler." },
  { title: "The medium", body: "is the message." },
  { title: "Premature optimization", body: "is the root of all evil." },
  { title: "There are only two hard things in computer science:", body: "cache invalidation and naming things." },
  { title: "Any sufficiently advanced technology", body: "is indistinguishable from magic." },
  { title: "The best way to predict the future", body: "is to invent it." },
  { title: "Make it work, make it right,", body: "make it fast." },
  { title: "All happy families are alike;", body: "each unhappy family is unhappy in its own way." },
  { title: "It's not the years, honey.", body: "It's the mileage." },
];

/** The preset for a document, stable per id. */
export function placeholderPreset(docId: string): PlaceholderPreset {
  const index = parseInt(blockHash(docId), 16) % PLACEHOLDER_PRESETS.length;
  return PLACEHOLDER_PRESETS[index];
}
