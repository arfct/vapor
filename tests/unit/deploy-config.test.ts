import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

// Just enough JSONC for our own config files: strips line and block comments.
function readJsonc(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text);
}

const base = readJsonc(join(root, "wrangler.jsonc"));
const deployDir = join(root, "deploy");
const instances = readdirSync(deployDir).filter((f) => f.endsWith(".jsonc"));

describe("wrangler.jsonc (the default, self-hostable config)", () => {
  it("names no domains and no instance vars, so a fresh deploy lands on workers.dev unmodified", () => {
    expect(base.routes).toBeUndefined();
    expect(base.vars).toEqual({});
    expect(JSON.stringify(base)).not.toContain("vapor.fyi");
  });

  it("declares the three Durable Objects, their SQLite migrations, and the attachments bucket", () => {
    const bindings = (base.durable_objects as { bindings: { name: string; class_name: string }[] }).bindings;
    expect(bindings.map((b) => b.class_name).sort()).toEqual(["DocumentAgent", "Registry", "VaporMcp"]);
    const migrated = (base.migrations as { new_sqlite_classes: string[] }[]).flatMap((m) => m.new_sqlite_classes);
    expect(migrated.sort()).toEqual(["DocumentAgent", "Registry", "VaporMcp"]);
    expect(base.r2_buckets).toEqual([{ binding: "ATTACHMENTS", bucket_name: expect.any(String) }]);
    expect(base.compatibility_flags).toContain("nodejs_compat");
  });
});

describe.each(instances)("deploy/%s", (file) => {
  const instance = readJsonc(join(deployDir, file));

  it("is the same worker as wrangler.jsonc — only domains and vars may differ", () => {
    // Same name and Durable Object layout, or a deploy would create a new
    // worker (or new DO namespaces) and orphan every live document.
    for (const key of ["name", "compatibility_date", "compatibility_flags", "durable_objects", "migrations", "r2_buckets", "observability", "keep_vars"]) {
      expect(instance[key], key).toEqual(base[key]);
    }
    expect(instance.main).toBe("../workers/app.ts");
    const allowed = new Set([...Object.keys(base), "routes", "vars", "account_id"]);
    for (const key of Object.keys(instance)) {
      expect(allowed.has(key), `unexpected key ${key}`).toBe(true);
    }
  });

  it("only sets vars the app knows about", () => {
    const known = ["GOOGLE_CLIENT_ID", "APPLE_CLIENT_ID", "SEND_FROM_EMAIL", "PUBLIC_ORIGIN", "REDIRECT_HOSTS", "OPERATOR_NAME", "SOURCE_URL"];
    for (const key of Object.keys((instance.vars as Record<string, string>) ?? {})) {
      expect(known, key).toContain(key);
    }
  });
});
