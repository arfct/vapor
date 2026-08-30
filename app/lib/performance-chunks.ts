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
 * - `"natural"`: 2-6 chars/tick, 30-80ms base delay; an extra 300-900ms
 *   pause is added after a tick ending in ".", "!", "?", or "\n".
 * - `"fast"`: 8-16 chars/tick, 10-20ms delay; no sentence pauses.
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
    pace === "fast" ? [8, 16, 10, 20] : [2, 6, 30, 80];

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
      extraDelayForNext = 300 + Math.floor(rng() * 601);
    }

    ticks.push({ chunk, delayMs });
  }

  return ticks;
}
