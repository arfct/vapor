import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  isValidDocumentId,
  generateDocumentId,
} from "~/shared/constants";
import { isReservedSlug } from "~/shared/agent-protocol";

describe("scaffolding", () => {
  it("exports app name", () => {
    expect(APP_NAME).toBe("vapor");
  });
});

describe("isValidDocumentId", () => {
  it("accepts valid 8-char lowercase alphanumeric IDs", () => {
    expect(isValidDocumentId("abcd1234")).toBe(true);
  });

  it("rejects IDs that are too short", () => {
    expect(isValidDocumentId("abc")).toBe(false);
  });

  it("rejects IDs with uppercase letters", () => {
    expect(isValidDocumentId("ABCD1234")).toBe(false);
  });
});

describe("generateDocumentId", () => {
  it("mints ids that are valid and never a reserved slug", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateDocumentId();
      expect(isValidDocumentId(id)).toBe(true);
      expect(isReservedSlug(id)).toBe(false);
    }
  });
});
