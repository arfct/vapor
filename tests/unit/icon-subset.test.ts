/**
 * Material Symbols is loaded as a named subset in root.tsx, so an icon name
 * that is not in it renders as its own ligature text: "print" where a printer
 * should be. That has shipped three times. This is the guard.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|ts)$/.test(entry) ? [path] : [];
  });
}

const subset = new Set(
  (/icon_names=([^&"]+)/.exec(readFileSync(join(root, "app", "root.tsx"), "utf8"))?.[1] ?? "").split(","),
);

/** Every `<Icon name="x" />` and every `icon="x"` prop, which Icon renders. */
function iconNames(source: string): string[] {
  return [
    ...source.matchAll(/<Icon\s+name=\{?"([a-z0-9_]+)"/g),
    ...source.matchAll(/\bicon="([a-z0-9_]+)"/g),
    ...source.matchAll(/\bicon:\s*"([a-z0-9_]+)"/g),
  ].map((m) => m[1]);
}

describe("Material Symbols subset", () => {
  it("lists every icon the app asks for", () => {
    expect(subset.size).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const file of sourceFiles(join(root, "app"))) {
      for (const name of iconNames(readFileSync(file, "utf8"))) {
        if (!subset.has(name)) missing.push(`${file.slice(root.length + 1)}: ${name}`);
      }
    }
    expect(missing, `add these to icon_names in app/root.tsx:\n${missing.join("\n")}`).toEqual([]);
  });

  it("is sorted and free of duplicates, so the next addition has an obvious place", () => {
    const names = [...subset];
    expect(names).toEqual([...new Set(names)]);
    expect(names).toEqual([...names].sort());
  });
});
