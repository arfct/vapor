import { Agent } from "agents";
import type { AgentCapability } from "../app/shared/agent-protocol";
import { randomShortId } from "../app/shared/short-id";
import { ledgerAllows, pruneLedger, type AttachmentError, type LedgerRow } from "../app/shared/attachment-policy";
import {
  buildWakeRequest,
  secretHint,
  validateWakeTarget,
  wakeBudget,
  type WakeBudgetState,
  type WakeEvent,
  type WakeKind,
  type WakeTargetView,
} from "../app/shared/wake-policy";
import { deriveWakeKey, openSecret, sealSecret } from "../app/shared/wake-crypto";

// Global identity registry, one instance ("global") per deployment.
// Modeled on subpixel's server/registry.ts, adapted to the Agents SDK and
// vapor's kv-on-sql test conventions. Key namespaces:
//   p:<principal>   -> Profile
//   u:<uid>         -> principal
//   e:<email>       -> principal (for resolving a typed address to a person)
//   alias:<old>     -> principal (a legacy `email:` principal, after re-keying)
//   oc:<clientId>   -> OAuthClient
//   code:<code>     -> AuthCode (single-use, 10 min TTL)
//   rt:<token>      -> RefreshGrant (rotated on use)
//   w:<principal>   -> WakeRecord

export interface Profile {
  principal: string;
  /** Public short id (eight lowercase alphanumerics): the only identity clients ever see. */
  uid: string;
  displayName: string;
  avatar: string | null;
  /** Private contact data; never sent to other collaborators. */
  email: string | null;
}

/** What a typed address resolves to for the `@` popup: name and public id, never the address back. */
export interface ResolvedPerson {
  uid: string;
  displayName: string;
  avatar: string | null;
}

const RESOLVE_PER_MINUTE = 30;

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: number;
}

export interface AuthCode {
  clientId: string;
  principal: string;
  email: string;
  caps: AgentCapability[];
  codeChallenge: string;
  redirectUri: string;
  exp: number;
}

/** A stored wake target (docs/plans/2026-09-06-agent-wake-plan.md). The secret is sealed; see wake-crypto. */
interface WakeRecord {
  kind: WakeKind;
  url: string;
  /** Origin of the request that saved the target: the instance's public URL as its owner reached it. */
  origin?: string;
  sealedSecret: string;
  secretHint: string;
  createdAt: number;
  updatedAt: number;
  lastFiredAt: number | null;
  lastStatus: number | null;
  lastError: string | null;
  budget: WakeBudgetState;
}

export type WakeOutcome =
  | { fired: true; status: number }
  | { fired: false; reason: "no_target" | "throttled" | "daily_cap" | "unsealable" | "delivery"; status?: number; error?: string };

export interface RefreshGrant {
  clientId: string;
  principal: string;
  email: string;
  caps: AgentCapability[];
  exp: number;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let b64 = "";
  for (const b of bytes) b64 += String.fromCharCode(b);
  return prefix + btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

class Registry extends Agent {
  private initialised = false;

  private ensureTable(): void {
    if (this.initialised) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `;
    // Attachment uploads per principal over a rolling day; pruned on write.
    this.sql`
      CREATE TABLE IF NOT EXISTS upload_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        principal TEXT,
        created_at INTEGER,
        bytes INTEGER
      )
    `;
    this.initialised = true;
  }

  // ---- Attachment budget (docs/plans/2026-09-05-attachments-plan.md) ----

  /**
   * Charge `bytes` to a principal's rolling 24-hour upload budget, or refuse.
   * The row is written up front so concurrent uploads can't both squeeze
   * through; a failed upload gives it back with releaseUploadBudget.
   */
  async reserveUploadBudget(
    principal: string,
    bytes: number,
  ): Promise<{ ok: true; ledgerId: number } | { error: AttachmentError }> {
    this.ensureTable();
    const now = Date.now();
    const rows = this.sql<LedgerRow & { id: number }>`
      SELECT id, created_at, bytes FROM upload_ledger WHERE principal = ${principal}
    `;
    const live = new Set(pruneLedger(rows, now).map((r) => (r as LedgerRow & { id: number }).id));
    for (const row of rows) if (!live.has(row.id)) this.sql`DELETE FROM upload_ledger WHERE id = ${row.id}`;
    const refused = ledgerAllows(rows, bytes, now);
    if (refused) return { error: refused };
    this.sql`INSERT INTO upload_ledger (principal, created_at, bytes) VALUES (${principal}, ${now}, ${bytes})`;
    const idRows = this.sql<{ id: number }>`SELECT last_insert_rowid() AS id`;
    return { ok: true, ledgerId: idRows?.[0]?.id ?? 0 };
  }

  async releaseUploadBudget(ledgerId: number): Promise<{ ok: true }> {
    this.ensureTable();
    this.sql`DELETE FROM upload_ledger WHERE id = ${ledgerId}`;
    return { ok: true };
  }

  private kvGet<T>(key: string): T | null {
    this.ensureTable();
    const rows = this.sql<{ value: string }>`
      SELECT value FROM kv WHERE key = ${key}
    `;
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].value) as T;
    } catch {
      return null;
    }
  }

  private kvPut(key: string, value: unknown): void {
    this.ensureTable();
    const encoded = JSON.stringify(value);
    this.sql`
      INSERT INTO kv (key, value) VALUES (${key}, ${encoded})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
  }

  private kvDelete(key: string): void {
    this.ensureTable();
    this.sql`DELETE FROM kv WHERE key = ${key}`;
  }

  /* ---------------- profiles ---------------- */

  /** A legacy `email:` principal that was re-keyed follows its alias to the live one. */
  private canonical(principal: string): string {
    return this.kvGet<string>(`alias:${principal}`) ?? principal;
  }

  /** Eight lowercase alphanumerics, unused: uniqueness is enforced here, not assumed from length. */
  private mintUid(): string {
    for (;;) {
      const uid = randomShortId();
      if (this.kvGet<string>(`u:${uid}`) === null) return uid;
    }
  }

  /**
   * Creates or refreshes the profile a sign-in describes. A profile still
   * keyed by the legacy `email:` principal is re-keyed to the new one in
   * place: same displayName, a fresh short uid, its wake target carried
   * over, and an alias so sessions and grants minted under the old
   * principal keep resolving until they expire.
   */
  async upsertProfile(
    principal: string,
    info: { displayName: string; avatar?: string; email?: string; legacyPrincipal?: string },
  ): Promise<{ profile: Profile }> {
    const email = info.email?.toLowerCase() ?? null;
    let existing = this.kvGet<Profile>(`p:${principal}`);

    if (!existing && info.legacyPrincipal && info.legacyPrincipal !== principal) {
      const legacy = this.kvGet<Profile & { agentSlug?: string | null }>(`p:${info.legacyPrincipal}`);
      if (legacy) {
        existing = { principal, uid: this.mintUid(), displayName: legacy.displayName, avatar: legacy.avatar, email };
        this.kvDelete(`p:${info.legacyPrincipal}`);
        this.kvDelete(`u:${legacy.uid}`);
        if (legacy.agentSlug) this.kvDelete(`a:${legacy.agentSlug}`);
        const wake = this.kvGet<WakeRecord>(`w:${info.legacyPrincipal}`);
        if (wake) {
          this.kvPut(`w:${principal}`, wake);
          this.kvDelete(`w:${info.legacyPrincipal}`);
        }
        this.kvPut(`alias:${info.legacyPrincipal}`, principal);
        this.kvPut(`u:${existing.uid}`, principal);
      }
    }

    const profile: Profile = existing
      ? {
          principal,
          uid: existing.uid,
          displayName: info.displayName,
          avatar: info.avatar ?? existing.avatar,
          email: email ?? existing.email ?? null,
        }
      : {
          principal,
          uid: this.mintUid(),
          displayName: info.displayName,
          avatar: info.avatar ?? null,
          email,
        };
    this.kvPut(`p:${principal}`, profile);
    this.kvPut(`u:${profile.uid}`, principal);
    if (profile.email) this.kvPut(`e:${profile.email}`, principal);
    return { profile };
  }

  async getProfile(principal: string): Promise<{ profile: Profile | null }> {
    return { profile: this.kvGet<Profile>(`p:${this.canonical(principal)}`) };
  }

  /**
   * The person behind a typed address, for the `@` popup: their name and
   * public id, so the mention can be inserted without the address ever
   * reaching the document. Signed-in requesters only (enforced by the
   * route), and at most RESOLVE_PER_MINUTE lookups a minute each, since
   * the answer reveals that an address has an account here.
   */
  async resolveEmail(
    requester: string,
    email: string,
  ): Promise<{ person: ResolvedPerson | null } | { error: { code: "rate_limited"; message: string } }> {
    const now = Date.now();
    const key = `rl:resolve:${this.canonical(requester)}`;
    const recent = (this.kvGet<number[]>(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RESOLVE_PER_MINUTE) {
      return { error: { code: "rate_limited", message: "Too many lookups; try again in a minute." } };
    }
    recent.push(now);
    this.kvPut(key, recent);

    const principal = this.kvGet<string>(`e:${email.toLowerCase()}`);
    const profile = principal ? this.kvGet<Profile>(`p:${this.canonical(principal)}`) : null;
    if (!profile) return { person: null };
    return { person: { uid: profile.uid, displayName: profile.displayName, avatar: profile.avatar } };
  }

  /* ---------------- wake targets ---------------- */

  private wakeKeyPromise: Promise<CryptoKey> | null = null;

  private wakeKey(): Promise<CryptoKey> {
    this.wakeKeyPromise ??= deriveWakeKey((this.env as { SESSION_SECRET?: string }).SESSION_SECRET ?? "");
    return this.wakeKeyPromise;
  }

  private wakeView(rec: WakeRecord, now = Date.now()): WakeTargetView {
    return {
      kind: rec.kind,
      url: rec.url,
      secretHint: rec.secretHint,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      lastFiredAt: rec.lastFiredAt,
      lastStatus: rec.lastStatus,
      lastError: rec.lastError,
      firesToday: rec.budget.fires.filter((t) => now - t < 24 * 60 * 60 * 1000).length,
    };
  }

  async getWakeTarget(principal: string): Promise<{ target: WakeTargetView | null }> {
    const rec = this.kvGet<WakeRecord>(`w:${this.canonical(principal)}`);
    return { target: rec ? this.wakeView(rec) : null };
  }

  /** Set or replace. Validation is the shared policy's; the secret is sealed before it is stored. */
  async setWakeTarget(
    principal: string,
    input: unknown,
    origin?: string,
  ): Promise<{ target: WakeTargetView } | { error: { code: "invalid_params"; message: string } }> {
    const checked = validateWakeTarget(input);
    if ("error" in checked) return { error: { code: "invalid_params", message: checked.error } };
    const { target } = checked;
    const now = Date.now();
    principal = this.canonical(principal);
    const existing = this.kvGet<WakeRecord>(`w:${principal}`);
    const rec: WakeRecord = {
      kind: target.kind,
      url: target.url,
      origin: origin ?? existing?.origin,
      sealedSecret: await sealSecret(target.secret, await this.wakeKey()),
      secretHint: secretHint(target.secret),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastFiredAt: null,
      lastStatus: null,
      lastError: null,
      // Replacing the target does not reset the day's spend.
      budget: existing?.budget ?? { fires: [], lastFiredByDoc: {} },
    };
    this.kvPut(`w:${principal}`, rec);
    return { target: this.wakeView(rec, now) };
  }

  async deleteWakeTarget(principal: string): Promise<{ ok: true }> {
    this.kvDelete(`w:${this.canonical(principal)}`);
    return { ok: true };
  }

  /**
   * Sends one wake for an addressed event, within the owner's budget. The
   * secret is opened only here. No retries: a routine fire is a new session,
   * so a retry after a lost response would double it. The outcome and the
   * receiver's status are kept for the owner to see.
   */
  async wake(args: { principal: string; event: WakeEvent; origin?: string }): Promise<WakeOutcome> {
    const key = `w:${this.canonical(args.principal)}`;
    const rec = this.kvGet<WakeRecord>(key);
    if (!rec) return { fired: false, reason: "no_target" };

    const now = Date.now();
    const isTest = args.event.name === "test";
    const budget = wakeBudget(rec.budget ?? { fires: [], lastFiredByDoc: {} }, args.event.docId, now, isTest);
    rec.budget = budget.next;
    if (!budget.allowed) {
      this.kvPut(key, rec);
      return { fired: false, reason: budget.reason };
    }

    const secret = await openSecret(rec.sealedSecret, await this.wakeKey());
    if (secret === null) {
      rec.lastError = "Stored secret could not be opened; save the target again.";
      this.kvPut(key, rec);
      return { fired: false, reason: "unsealable" };
    }

    // Document links in the wake text: the caller's origin (a request, or
    // PUBLIC_ORIGIN) first, else the origin this target was saved from.
    const origin = args.origin ?? rec.origin ?? "";
    const request = await buildWakeRequest({ kind: rec.kind, url: rec.url, secret }, args.event, origin, now);
    let status = 0;
    let error: string | null = null;
    try {
      const res = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body });
      status = res.status;
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        error = `HTTP ${res.status}${text ? `: ${text}` : ""}`;
      }
    } catch (e) {
      error = `Could not reach the target: ${e instanceof Error ? e.message : String(e)}`;
    }

    rec.lastFiredAt = now;
    rec.lastStatus = status || null;
    rec.lastError = error;
    this.kvPut(key, rec);
    return error === null ? { fired: true, status } : { fired: false, reason: "delivery", status: status || undefined, error };
  }

  /* ---------------- oauth state ---------------- */

  async registerClient(info: {
    name: string;
    redirectUris: string[];
  }): Promise<{ client: OAuthClient }> {
    const client: OAuthClient = {
      clientId: crypto.randomUUID(),
      name: info.name,
      redirectUris: info.redirectUris,
      createdAt: Date.now(),
    };
    this.kvPut(`oc:${client.clientId}`, client);
    return { client };
  }

  async getClient(clientId: string): Promise<{ client: OAuthClient | null }> {
    return { client: this.kvGet<OAuthClient>(`oc:${clientId}`) };
  }

  async putCode(
    data: Omit<AuthCode, "exp">,
  ): Promise<{ code: string }> {
    const code = randomToken("vac_");
    this.kvPut(`code:${code}`, { ...data, exp: Date.now() + CODE_TTL_MS } satisfies AuthCode);
    return { code };
  }

  /** Single use: the code is deleted whether or not it is still valid. */
  async takeCode(code: string): Promise<{ data: AuthCode | null }> {
    const data = this.kvGet<AuthCode>(`code:${code}`);
    this.kvDelete(`code:${code}`);
    if (!data || data.exp < Date.now()) return { data: null };
    return { data };
  }

  /** Refresh tokens are hashed at rest (subpixel convention): a Registry
   *  dump never yields usable credentials. Callers hold the raw token. */
  async putRefresh(
    data: Omit<RefreshGrant, "exp">,
  ): Promise<{ token: string }> {
    const token = randomToken("var_");
    this.kvPut(`rt:${await sha256Hex(token)}`, {
      ...data,
      exp: Date.now() + REFRESH_TTL_MS,
    } satisfies RefreshGrant);
    return { token };
  }

  /** Rotation: the old (raw) token is consumed; a fresh one is issued for
   *  the same grant. No family-replay revocation this phase. */
  async rotateRefresh(
    oldToken: string,
  ): Promise<{ token: string; data: RefreshGrant } | { error: { code: string; message: string } }> {
    const oldKey = `rt:${await sha256Hex(oldToken)}`;
    const data = this.kvGet<RefreshGrant>(oldKey);
    this.kvDelete(oldKey);
    if (!data || data.exp < Date.now()) {
      return { error: { code: "invalid_grant", message: "Refresh token is unknown or expired" } };
    }
    const token = randomToken("var_");
    this.kvPut(`rt:${await sha256Hex(token)}`, {
      ...data,
      exp: Date.now() + REFRESH_TTL_MS,
    } satisfies RefreshGrant);
    return { token, data };
  }

  async revokeRefresh(token: string): Promise<{ ok: true }> {
    this.kvDelete(`rt:${await sha256Hex(token)}`);
    return { ok: true };
  }
}

export default Registry;
