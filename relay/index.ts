/**
 * vapor → Claude routine relay: the ~30 lines that turn a vapor webhook
 * into a woken Claude session (scenario 2 of the events polyfill plan).
 *
 * Verifies the Standard Webhooks signature from vapor, then forwards the
 * event body as `text` to the routine's /fire endpoint. Holds exactly two
 * secrets: the whsec used at events_subscribe time, and the routine's own
 * fire token (scoped to firing that one routine — the narrowest credential
 * this job could have).
 *
 * Deploy: npx wrangler deploy -c relay/wrangler.jsonc
 * Secrets: WEBHOOK_SECRET (whsec_…), FIRE_TOKEN (sk-ant-oat01-…)
 */

interface RelayEnv {
  WEBHOOK_SECRET: string;
  FIRE_TOKEN: string;
  ROUTINE_ID: string;
}

const TIMESTAMP_TOLERANCE_S = 300;

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("vapor mention relay: POST Standard-Webhooks deliveries here", { status: 200 });
    }

    const body = await request.text();
    const id = request.headers.get("webhook-id");
    const ts = request.headers.get("webhook-timestamp");
    const sig = request.headers.get("webhook-signature");
    if (!id || !ts || !sig) return new Response("missing signature headers", { status: 400 });
    if (Math.abs(Date.now() / 1000 - Number(ts)) > TIMESTAMP_TOLERANCE_S) {
      return new Response("stale timestamp", { status: 400 });
    }

    const raw = Uint8Array.from(atob(env.WEBHOOK_SECRET.slice("whsec_".length)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
    );
    const expected = "v1," + btoa(String.fromCharCode(...mac));
    const provided = sig.split(/\s+/).find((s) => s.startsWith("v1,"));
    if (provided !== expected) return new Response("bad signature", { status: 401 });

    const fire = await fetch(
      `https://api.anthropic.com/v1/claude_code/routines/${env.ROUTINE_ID}/fire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FIRE_TOKEN}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: body }),
      },
    );

    if (!fire.ok) {
      console.error(`fire failed: ${fire.status} ${await fire.text()}`);
      return new Response("fire failed", { status: 502 });
    }
    return new Response("fired", { status: 200 });
  },
};
