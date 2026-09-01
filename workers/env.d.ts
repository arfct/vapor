// Bindings that exist at runtime but aren't derivable from wrangler.jsonc:
// SESSION_SECRET is a Workers secret (`wrangler secret put SESSION_SECRET`;
// locally via .dev.vars) and GOOGLE_CLIENT_ID is a plain var. Declared here
// so typegen output is identical with or without a .dev.vars present (CI
// has none). Runtime code still guards their absence explicitly — a secret
// can be unset in a fresh environment regardless of what the type says.
interface Env {
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
}

declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    GOOGLE_CLIENT_ID: string;
  }
}
