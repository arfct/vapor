import { Agent } from "agents";
import { slugifyAgentName } from "../app/shared/agent-protocol";
import type { AgentCapability } from "../app/shared/agent-protocol";

// Global identity registry, one instance ("global") per deployment.
// Modeled on subpixel's server/registry.ts, adapted to the Agents SDK and
// vapor's kv-on-sql test conventions. Key namespaces:
//   p:<principal>   -> Profile
//   u:<uid>         -> principal
//   a:<agentSlug>   -> principal
//   oc:<clientId>   -> OAuthClient
//   code:<code>     -> AuthCode (single-use, 10 min TTL)
//   rt:<token>      -> RefreshGrant (rotated on use)

export interface Profile {
  principal: string;
  uid: string;
  displayName: string;
  avatar: string | null;
  agentSlug: string | null;
}

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
    this.initialised = true;
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

  async upsertProfile(
    principal: string,
    info: { displayName: string; avatar?: string },
  ): Promise<{ profile: Profile }> {
    const existing = this.kvGet<Profile>(`p:${principal}`);
    const profile: Profile = existing
      ? { ...existing, displayName: info.displayName, avatar: info.avatar ?? existing.avatar }
      : {
          principal,
          uid: crypto.randomUUID(),
          displayName: info.displayName,
          avatar: info.avatar ?? null,
          agentSlug: null,
        };
    this.kvPut(`p:${principal}`, profile);
    if (!existing) {
      this.kvPut(`u:${profile.uid}`, principal);
    }
    return { profile };
  }

  async getProfile(principal: string): Promise<{ profile: Profile | null }> {
    return { profile: this.kvGet<Profile>(`p:${principal}`) };
  }

  /**
   * The user's stable counterpart-agent slug: derived from the display
   * name on first request, globally unique, then never changed here.
   */
  async ensureAgentSlug(
    principal: string,
  ): Promise<{ slug: string } | { error: { code: string; message: string } }> {
    const profile = this.kvGet<Profile>(`p:${principal}`);
    if (!profile) {
      return { error: { code: "not_found", message: "No profile for principal" } };
    }
    if (profile.agentSlug) return { slug: profile.agentSlug };

    const base = slugifyAgentName(profile.displayName);
    let candidate = base;
    for (let n = 2; this.kvGet<string>(`a:${candidate}`) !== null; n++) {
      candidate = `${base}-${n}`;
    }
    profile.agentSlug = candidate;
    this.kvPut(`p:${principal}`, profile);
    this.kvPut(`a:${candidate}`, principal);
    return { slug: candidate };
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
