export interface TypingTick {
  chunk: string;
  delayMs: number;
}

/** Characters after which a sentence-pause is inserted, at "natural" pace. */
const SENTENCE_ENDINGS = new Set([".", "!", "?", "\n"]);

/**
 * Splits `text` into a sequence of typing ticks — chunks of characters plus
 * the delay before the *next* chunk — used to simulate an agent typing into
 * the document instead of pasting it in one shot.
 *
 * - `"natural"`: 2-4 chars/tick, 60-107ms base delay (~36 chars/s); an extra
 *   100-300ms pause is added after a tick ending in ".", "!", "?", or "\n".
 * - `"fast"`: 6-12 chars/tick, 7-13ms delay; no sentence pauses.
 *
 * Both paces were tripled on 2026-09-13 at Nicholas's request. "natural" is
 * named for its shape, not its rate: 36 chars/s is roughly 430 words a
 * minute, well past any typist.
 *
 * `rng` defaults to `Math.random` and is injectable so tests can produce
 * deterministic output (e.g. `() => 0.5`).
 */
export function chunkTyping(
  text: string,
  pace: "natural" | "fast",
  rng: () => number = Math.random,
): TypingTick[] {
  const ticks: TypingTick[] = [];

  const [minChars, maxChars, minDelay, maxDelay] =
    pace === "fast" ? [6, 12, 7, 13] : [2, 4, 60, 107];

  let cursor = 0;
  // Carried from a sentence-ending chunk onto the delay of the *next*
  // tick, so the pause reads as "after the sentence, before typing on".
  let extraDelayForNext = 0;
  while (cursor < text.length) {
    const size = Math.min(
      minChars + Math.floor(rng() * (maxChars - minChars + 1)),
      text.length - cursor,
    );
    let chunk = text.slice(cursor, cursor + size);

    if (pace === "natural") {
      // Force a chunk boundary right after a sentence-ending character so
      // the pause can land cleanly between it and the next tick.
      for (let i = 0; i < chunk.length; i++) {
        if (SENTENCE_ENDINGS.has(chunk[i])) {
          chunk = chunk.slice(0, i + 1);
          break;
        }
      }
    }
    cursor += chunk.length;

    const delayMs = minDelay + Math.floor(rng() * (maxDelay - minDelay + 1)) + extraDelayForNext;
    extraDelayForNext = 0;
    if (pace === "natural" && SENTENCE_ENDINGS.has(chunk[chunk.length - 1])) {
      extraDelayForNext = 100 + Math.floor(rng() * 201);
    }

    ticks.push({ chunk, delayMs });
  }

  return ticks;
}
