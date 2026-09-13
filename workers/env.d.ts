// Bindings that exist at runtime but aren't derivable from wrangler.jsonc:
// SESSION_SECRET is a Workers secret (`wrangler secret put SESSION_SECRET`;
// locally via .dev.vars); GOOGLE_CLIENT_ID and APPLE_CLIENT_ID are plain vars. Declared here
// so typegen output is identical with or without a .dev.vars present (CI
// has none). Runtime code still guards their absence explicitly — a secret
// can be unset in a fresh environment regardless of what the type says.
//
// The optional per-instance vars (PUBLIC_ORIGIN, REDIRECT_HOSTS,
// OPERATOR_NAME, SOURCE_URL) are documented in app/shared/site.ts and
// docs/self-hosting.md; every one has a working default.
interface Env {
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  APPLE_CLIENT_ID?: string;
  ATTACHMENTS: R2Bucket;
  PUBLIC_ORIGIN?: string;
  REDIRECT_HOSTS?: string;
  OPERATOR_NAME?: string;
  SOURCE_URL?: string;
  /** Send to Kindle by email (#100): a Resend API key (secret) and the approved sender address (var). Both optional. */
  RESEND_API_KEY?: string;
  SEND_FROM_EMAIL?: string;
  /** OpenAI plugin portal domain-verification token, served at /.well-known/openai-apps-challenge (#103). */
  OPENAI_APPS_CHALLENGE?: string;
}

declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    APPLE_CLIENT_ID?: string;
    ATTACHMENTS: R2Bucket;
    PUBLIC_ORIGIN?: string;
    REDIRECT_HOSTS?: string;
    OPERATOR_NAME?: string;
    SOURCE_URL?: string;
    RESEND_API_KEY?: string;
    SEND_FROM_EMAIL?: string;
    OPENAI_APPS_CHALLENGE?: string;
  }
}
