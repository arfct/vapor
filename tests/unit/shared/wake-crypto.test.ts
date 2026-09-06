import { describe, it, expect } from "vitest";
import { deriveWakeKey, openSecret, sealSecret } from "~/shared/wake-crypto";

describe("wake secret sealing", () => {
  it("round-trips under the same session secret with a fresh IV each time", async () => {
    const key = await deriveWakeKey("session-secret-1");
    const a = await sealSecret("sk-ant-oat01-abc", key);
    const b = await sealSecret("sk-ant-oat01-abc", key);
    expect(a).not.toBe(b);
    expect(await openSecret(a, key)).toBe("sk-ant-oat01-abc");
    expect(await openSecret(b, key)).toBe("sk-ant-oat01-abc");
  });

  it("cannot be opened under a different session secret", async () => {
    const sealed = await sealSecret("whsec_abc", await deriveWakeKey("session-secret-1"));
    expect(await openSecret(sealed, await deriveWakeKey("session-secret-2"))).toBeNull();
  });

  it("returns null for garbage rather than throwing", async () => {
    const key = await deriveWakeKey("session-secret-1");
    expect(await openSecret("not base64!", key)).toBeNull();
    expect(await openSecret("AAAA", key)).toBeNull();
    expect(await openSecret("", key)).toBeNull();
  });

  it("refuses to derive a key from an empty secret", async () => {
    await expect(deriveWakeKey("")).rejects.toThrow(/SESSION_SECRET/);
  });
});
