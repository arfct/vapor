import { ANON_ANIMALS, ANON_ADJECTIVES } from "~/shared/anon-animals";
import { USER_COLOURS } from "~/shared/constants";
import type { AnonAnimal } from "~/shared/anon-animals";

const STORAGE_KEY = "vapor-anon";
const FORMER_KEY = "vapor-former-anon-id";

export interface AnonIdentity {
  id: string;
  adjective: string;
  animal: AnonAnimal;
  colorIndex: number;
}

interface StoredAnon {
  id: string;
  animalIndex: number;
  colorIndex: number;
  /** Absent in identities stored before adjectives existed. */
  adjectiveIndex?: number;
}

function randomIndex(bound: number): number {
  return Math.floor(Math.random() * bound);
}

function toIdentity(stored: StoredAnon): AnonIdentity {
  return {
    id: stored.id,
    adjective: ANON_ADJECTIVES[(stored.adjectiveIndex ?? 0) % ANON_ADJECTIVES.length],
    animal: ANON_ANIMALS[stored.animalIndex % ANON_ANIMALS.length],
    colorIndex: stored.colorIndex % USER_COLOURS.length,
  };
}

/**
 * The browser's persistent anonymous identity: a stable random id, an
 * animal, and a cursor colour, assigned once and reused across documents
 * and sessions. Falls back to an ephemeral identity when localStorage is
 * unavailable (private windows, SSR-adjacent environments).
 */
export function getAnonIdentity(): AnonIdentity {
  const fresh: StoredAnon = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${randomIndex(1_000_000)}`,
    animalIndex: randomIndex(ANON_ANIMALS.length),
    colorIndex: randomIndex(USER_COLOURS.length),
    adjectiveIndex: randomIndex(ANON_ADJECTIVES.length),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredAnon>;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.animalIndex === "number" &&
        typeof parsed.colorIndex === "number"
      ) {
        // Identities stored before adjectives existed get one now, once.
        if (typeof parsed.adjectiveIndex !== "number") {
          parsed.adjectiveIndex = randomIndex(ANON_ADJECTIVES.length);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        return toIdentity(parsed as StoredAnon);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // Storage unavailable — ephemeral identity for this page view.
  }
  return toIdentity(fresh);
}

/**
 * Called after sign-in: retires the anonymous id so future doc visits can
 * re-attribute this browser's earlier anonymous work to the signed-in
 * principal. Returns the retired id, or null if there was none.
 */
export function retireAnonId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnon>;
    if (typeof parsed.id !== "string") return null;
    localStorage.setItem(FORMER_KEY, parsed.id);
    localStorage.removeItem(STORAGE_KEY);
    return parsed.id;
  } catch {
    return null;
  }
}

/** The previously retired anonymous id, for re-attribution on doc visits. */
export function formerAnonId(): string | null {
  try {
    return localStorage.getItem(FORMER_KEY);
  } catch {
    return null;
  }
}
