/**
 * Anonymous presence animals, Google-Docs style.
 *
 * Glyphs are rendered in the monochrome Noto Emoji font (loaded in
 * root.tsx) so they inherit `color` and can be tinted with the user's
 * cursor colour. Every glyph below has coverage in Noto Emoji.
 */
export interface AnonAnimal {
  glyph: string;
  name: string;
}

/**
 * Adjectives paired with the animal — "Anonymous" is just one of the
 * collection, so a visitor might be a Cowardly Lion or a Mysterious
 * Octopus. Assigned once per browser, like the animal and colour.
 */
export const ANON_ADJECTIVES: readonly string[] = [
  "Anonymous",
  "Cowardly",
  "Mysterious",
  "Bashful",
  "Curious",
  "Sleepy",
  "Dapper",
  "Skeptical",
  "Wandering",
  "Punctual",
  "Suspicious",
  "Heroic",
  "Melodramatic",
] as const;

export const ANON_ANIMALS: readonly AnonAnimal[] = [
  { glyph: "🐙", name: "Octopus" },
  { glyph: "🦊", name: "Fox" },
  { glyph: "🦝", name: "Raccoon" },
  { glyph: "🐢", name: "Turtle" },
  { glyph: "🦉", name: "Owl" },
  { glyph: "🐸", name: "Frog" },
  { glyph: "🦆", name: "Duck" },
  { glyph: "🦡", name: "Badger" },
  { glyph: "🦦", name: "Otter" },
  { glyph: "🐨", name: "Koala" },
  { glyph: "🐼", name: "Panda" },
  { glyph: "🦔", name: "Hedgehog" },
  { glyph: "🐰", name: "Rabbit" },
  { glyph: "🐿️", name: "Chipmunk" },
  { glyph: "🦇", name: "Bat" },
  { glyph: "🐺", name: "Wolf" },
  { glyph: "🦁", name: "Lion" },
  { glyph: "🐯", name: "Tiger" },
  { glyph: "🐮", name: "Cow" },
  { glyph: "🐷", name: "Pig" },
  { glyph: "🐭", name: "Mouse" },
  { glyph: "🐹", name: "Hamster" },
  { glyph: "🐻", name: "Bear" },
  { glyph: "🐧", name: "Penguin" },
  { glyph: "🐤", name: "Chick" },
  { glyph: "🦅", name: "Eagle" },
  { glyph: "🦜", name: "Parrot" },
  { glyph: "🦢", name: "Swan" },
  { glyph: "🦩", name: "Flamingo" },
  { glyph: "🦚", name: "Peacock" },
  { glyph: "🐬", name: "Dolphin" },
  { glyph: "🐳", name: "Whale" },
  { glyph: "🐠", name: "Fish" },
  { glyph: "🦈", name: "Shark" },
  { glyph: "🦭", name: "Seal" },
  { glyph: "🐊", name: "Crocodile" },
  { glyph: "🦎", name: "Lizard" },
  { glyph: "🐍", name: "Snake" },
  { glyph: "🦋", name: "Butterfly" },
  { glyph: "🐝", name: "Bee" },
  { glyph: "🐞", name: "Ladybug" },
  { glyph: "🦀", name: "Crab" },
  { glyph: "🦞", name: "Lobster" },
  { glyph: "🐌", name: "Snail" },
] as const;
