import { DOCUMENT_TTL_MS } from "~/shared/constants";

/** "98h" / "12m" / "soon": how long until a document created at `createdAt` vaporizes. */
export function formatRemainingTime(createdAt: number): string {
  const elapsed = Date.now() - createdAt;
  const remainingMs = DOCUMENT_TTL_MS - elapsed;
  if (remainingMs <= 0) return "soon";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `${minutes}m`;
}
