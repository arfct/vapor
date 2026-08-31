import { describe, it, expect } from "vitest";
import {
  mintSessionToken,
  verifySessionToken,
  verifyGoogleIdToken,
  sessionFromRequest,
  sessionCookieHeader,
  principalFromEmail,
  SESSION_COOKIE,
} from "~/lib/auth.server";

const SECRET = "a".repeat(32);

// ---- base64url + fixture-JWT helpers (deliberately independent of the
// module under test, so tests exercise the public contract only) ----

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

type FixtureKeys = { privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

async function generateFixtureKeys(kid = "test-kid"): Promise<FixtureKeys> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey & { kid: string };
  jwk.kid = kid;
  return { privateKey, jwk };
}

async function signIdToken(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = base64UrlFromJson({ alg: "RS256", kid, typ: "JWT" });
  const body = base64UrlFromJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const now = () => Math.floor(Date.now() / 1000);

function validGooglePayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: now() + 3600,
    email: "Foo@Bar.com",
    email_verified: true,
    name: "Foo Bar",
    picture: "https://example.com/pic.png",
    ...overrides,
  };
}

describe("principalFromEmail", () => {
  it("lowercases and prefixes", () => {
    expect(principalFromEmail("Foo@Bar.COM")).toBe("email:foo@bar.com");
  });
});

describe("session mint/verify round trip", () => {
  it("verifies a token it minted", async () => {
    const token = await mintSessionToken(
      { principal: "email:foo@bar.com", email: "foo@bar.com" },
      SECRET,
    );
    const claims = await verifySessionToken(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.principal).toBe("email:foo@bar.com");
    expect(claims?.email).toBe("foo@bar.com");
    expect(typeof claims?.iat).toBe("number");
    expect(typeof claims?.exp).toBe("number");
  });

  it("carries optional caps through", async () => {
    const token = await mintSessionToken(
      { principal: "email:foo@bar.com", email: "foo@bar.com", caps: ["comment", "suggest"] },
      SECRET,
    );
    const claims = await verifySessionToken(token, SECRET);
    expect(claims?.caps).toEqual(["comment", "suggest"]);
  });

  it("rejects a token minted with a different secret", async () => {
    const token = await mintSessionToken(
      { principal: "email:foo@bar.com", email: "foo@bar.com" },
      SECRET,
    );
    const claims = await verifySessionToken(token, "b".repeat(32));
    expect(claims).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await mintSessionToken(
      { principal: "email:foo@bar.com", email: "foo@bar.com" },
      SECRET,
      -10,
    );
    const claims = await verifySessionToken(token, SECRET);
    expect(claims).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await mintSessionToken(
      { principal: "email:foo@bar.com", email: "foo@bar.com" },
      SECRET,
    );
    const [header, , signature] = token.split(".");
    const tamperedPayload = base64UrlFromJson({
      principal: "email:attacker@bar.com",
      email: "attacker@bar.com",
      iat: now(),
      exp: now() + 1000,
    });
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
    // sanity: the untampered token still round-trips
    expect(await verifySessionToken(token, SECRET)).not.toBeNull();
  });

  it("rejects garbage tokens", async () => {
    expect(await verifySessionToken("not.a.jwt", SECRET)).toBeNull();
    expect(await verifySessionToken("", SECRET)).toBeNull();
  });
});

describe("verifyGoogleIdToken", () => {
  it("accepts a fixture-signed token with correct aud/iss/exp", async () => {
    const { privateKey, jwk } = await generateFixtureKeys();
    const token = await signIdToken(privateKey, jwk.kid, validGooglePayload());
    const fetchJwks = async () => [jwk];
    const result = await verifyGoogleIdToken(token, CLIENT_ID, fetchJwks);
    expect(result).toEqual({
      email: "foo@bar.com",
      name: "Foo Bar",
      picture: "https://example.com/pic.png",
    });
  });

  it("rejects the wrong audience", async () => {
    const { privateKey, jwk } = await generateFixtureKeys();
    const token = await signIdToken(privateKey, jwk.kid, validGooglePayload({ aud: "someone-else" }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });

  it("rejects the wrong issuer", async () => {
    const { privateKey, jwk } = await generateFixtureKeys();
    const token = await signIdToken(privateKey, jwk.kid, validGooglePayload({ iss: "evil.example.com" }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwk } = await generateFixtureKeys();
    const token = await signIdToken(privateKey, jwk.kid, validGooglePayload({ exp: now() - 10 }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });

  it("rejects a bad signature (signed by an unrelated key)", async () => {
    const { jwk } = await generateFixtureKeys();
    const attacker = await generateFixtureKeys(jwk.kid);
    // Token is signed by the attacker's private key but claims the
    // legitimate kid; the JWKS fixture only knows the legitimate public key.
    const token = await signIdToken(attacker.privateKey, jwk.kid, validGooglePayload());
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });

  it("rejects an unverified email", async () => {
    const { privateKey, jwk } = await generateFixtureKeys();
    const token = await signIdToken(privateKey, jwk.kid, validGooglePayload({ email_verified: false }));
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });

  it("rejects an unknown kid", async () => {
    const { privateKey, jwk } = await generateFixtureKeys("kid-a");
    const token = await signIdToken(privateKey, "kid-b", validGooglePayload());
    const result = await verifyGoogleIdToken(token, CLIENT_ID, async () => [jwk]);
    expect(result).toBeNull();
  });
});

describe("sessionCookieHeader", () => {
  it("produces the expected cookie shape", () => {
    const header = sessionCookieHeader("tok123", 86400, false);
    expect(header).toBe(`${SESSION_COOKIE}=tok123; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax`);
  });

  it("adds Secure when requested", () => {
    const header = sessionCookieHeader("tok123", 86400, true);
    expect(header).toContain("; Secure");
  });

  it("uses the vp_session cookie name", () => {
    expect(SESSION_COOKIE).toBe("vp_session");
  });
});

describe("sessionFromRequest", () => {
  it("reads the session from the vp_session cookie", async () => {
    const token = await mintSessionToken({ principal: "email:foo@bar.com", email: "foo@bar.com" }, SECRET);
    const request = new Request("https://vapor.fyi/", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const claims = await sessionFromRequest(request, SECRET);
    expect(claims?.principal).toBe("email:foo@bar.com");
  });

  it("falls back to an Authorization: Bearer header", async () => {
    const token = await mintSessionToken({ principal: "email:foo@bar.com", email: "foo@bar.com" }, SECRET);
    const request = new Request("https://vapor.fyi/", {
      headers: { authorization: `Bearer ${token}` },
    });
    const claims = await sessionFromRequest(request, SECRET);
    expect(claims?.principal).toBe("email:foo@bar.com");
  });

  it("returns null with no credential", async () => {
    const request = new Request("https://vapor.fyi/");
    expect(await sessionFromRequest(request, SECRET)).toBeNull();
  });
});
