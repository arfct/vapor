// Bindings that exist at runtime but aren't derivable from wrangler.jsonc:
// SESSION_SECRET is a Workers secret (`wrangler secret put SESSION_SECRET`;
// locally via .dev.vars) and GOOGLE_CLIENT_ID is set as a plain var at
// deploy time / in .dev.vars. Declared optional so code handles their
// absence explicitly.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
  }
}
