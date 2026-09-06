import { describe, it, expect } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_DOC,
  PRINCIPAL_WINDOW_BYTES,
  PRINCIPAL_WINDOW_MS,
  sniffContentType,
  sanitizeFilename,
  mintAttachmentId,
  ATTACHMENT_ID_RE,
  attachmentPath,
  parseAttachmentUrl,
  absolutizeAttachmentUrls,
  budgetAllows,
  ledgerAllows,
  formatBytes,
} from "~/shared/attachment-policy";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const TEXT = new TextEncoder().encode("# hello\n");

describe("sniffContentType", () => {
  it("accepts images whose bytes match their extension and refuses mismatches", () => {
    expect(sniffContentType("a.png", PNG)).toBe("image/png");
    expect(sniffContentType("a.jpg", JPEG)).toBe("image/jpeg");
    expect(sniffContentType("a.png", JPEG)).toBeNull();
    expect(sniffContentType("a.png", TEXT)).toBeNull();
  });
  it("refuses html, svg, scripts, and unknown extensions outright", () => {
    for (const name of ["page.html", "pic.svg", "run.js", "app.exe", "noext"]) {
      expect(sniffContentType(name, TEXT)).toBeNull();
    }
  });
  it("takes text and markdown when there are no NUL bytes", () => {
    expect(sniffContentType("notes.md", TEXT)).toBe("text/markdown");
    expect(sniffContentType("notes.txt", new Uint8Array([104, 0, 105]))).toBeNull();
  });
  it("needs a zip signature for zip-based office files", () => {
    expect(sniffContentType("deck.pptx", ZIP)).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(sniffContentType("deck.pptx", TEXT)).toBeNull();
    expect(sniffContentType("archive.zip", ZIP)).toBe("application/zip");
  });
});

describe("filenames and addresses", () => {
  it("sanitizes a filename for a URL and a header", () => {
    expect(sanitizeFilename('../../My "Report" #1?.pdf')).toBe("My-Report-1.pdf");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });
  it("mints 16-character base32 ids", () => {
    const id = mintAttachmentId();
    expect(id).toMatch(ATTACHMENT_ID_RE);
    expect(mintAttachmentId()).not.toBe(id);
  });
  it("builds and parses the attachment path, relative or absolute", () => {
    const path = attachmentPath("abcd1234", "abcdefghijklmnop", "my file.png");
    expect(path).toBe("/abcd1234/attachments/abcdefghijklmnop/my%20file.png");
    expect(parseAttachmentUrl(path)).toEqual({
      docId: "abcd1234",
      id: "abcdefghijklmnop",
      filename: "my file.png",
      path,
    });
    expect(parseAttachmentUrl(`https://vapor.fyi${path}`)?.path).toBe(path);
    expect(parseAttachmentUrl("https://example.com/cat.png")).toBeNull();
    expect(parseAttachmentUrl("/abcd1234/attachments/short/x.png")).toBeNull();
  });
  it("rewrites relative attachment links to the export origin only", () => {
    const md = "![a](/abcd1234/attachments/abcdefghijklmnop/a.png) and [b](https://example.com/b)";
    expect(absolutizeAttachmentUrls(md, "https://vapor.fyi")).toBe(
      "![a](https://vapor.fyi/abcd1234/attachments/abcdefghijklmnop/a.png) and [b](https://example.com/b)",
    );
  });
});

describe("budgets", () => {
  it("caps one file, the document's total, and its file count", () => {
    const fresh = { readyBytes: 0, reservedBytes: 0, count: 0 };
    expect(budgetAllows(fresh, MAX_FILE_BYTES)).toBeNull();
    expect(budgetAllows(fresh, MAX_FILE_BYTES + 1)).toBe("attachment_too_large");
    expect(budgetAllows({ ...fresh, count: MAX_FILES_PER_DOC }, 10)).toBe("attachment_budget");
    expect(budgetAllows({ readyBytes: 99 * 1024 * 1024, reservedBytes: 1024 * 1024, count: 1 }, 1)).toBe(
      "attachment_budget",
    );
  });
  it("meters a principal over a rolling day by bytes and by count", () => {
    const now = 1_000_000_000;
    const old = { created_at: now - PRINCIPAL_WINDOW_MS - 1, bytes: PRINCIPAL_WINDOW_BYTES };
    expect(ledgerAllows([old], 1, now)).toBeNull();
    const recent = { created_at: now - 1000, bytes: PRINCIPAL_WINDOW_BYTES - 5 };
    expect(ledgerAllows([recent], 10, now)).toBe("principal_budget");
    const many = Array.from({ length: 200 }, () => ({ created_at: now - 10, bytes: 1 }));
    expect(ledgerAllows(many, 1, now)).toBe("principal_budget");
  });
});

describe("formatBytes", () => {
  it("reads like a file browser", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });
});
