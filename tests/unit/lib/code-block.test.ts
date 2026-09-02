// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlock, CODE_LANGUAGES } from "~/lib/code-block";
import { CodeBlockCopy } from "~/lib/code-block-copy";

const JS_BLOCK = '<pre><code class="language-js">const a = 1;\nreturn a;</code></pre><p>after</p>';

let editor: Editor | null = null;

function createEditor(content: string) {
  editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false, codeBlock: false }), CodeBlock, CodeBlockCopy],
    content,
  });
  return editor;
}

function languageSelect(ed: Editor): HTMLSelectElement {
  const select = ed.view.dom.querySelector<HTMLSelectElement>("pre select.code-lang");
  if (!select) throw new Error("language select not rendered");
  return select;
}

function pickLanguage(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("CodeBlock highlighting", () => {
  it("wraps tokens of a js fence in hljs-* spans", () => {
    const ed = createEditor(JS_BLOCK);
    const keywords = Array.from(ed.view.dom.querySelectorAll("pre code .hljs-keyword"));
    expect(keywords.map((el) => el.textContent)).toEqual(["const", "return"]);
    expect(ed.view.dom.querySelector("pre code .hljs-number")?.textContent).toBe("1");
  });

  it("keeps the language attr as written so the fence round-trips", () => {
    const ed = createEditor(JS_BLOCK);
    expect(ed.state.doc.firstChild?.type.name).toBe("codeBlock");
    expect(ed.state.doc.firstChild?.attrs.language).toBe("js");
    expect(ed.view.dom.querySelector("pre code")?.className).toBe("language-js");
  });
});

describe("CodeBlock language selector", () => {
  it("is non-editable UI inside pre, listing auto plus the common languages", () => {
    const ed = createEditor('<pre><code class="language-python">x = 1</code></pre>');
    const select = languageSelect(ed);
    expect(select.contentEditable).toBe("false");
    expect(select.getAttribute("aria-label")).toBe("Code language");
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", ...CODE_LANGUAGES]);
    expect(select.options[0].textContent).toBe("auto");
    expect(select.value).toBe("python");
    expect(CODE_LANGUAGES).toContain("javascript");
    expect(CODE_LANGUAGES.length).toBeGreaterThan(20);
  });

  it("shows an alias or unknown fence language as a temporary option", () => {
    const ed = createEditor(JS_BLOCK);
    expect(languageSelect(ed).value).toBe("js");
  });

  it("shows auto for a block without a language", () => {
    const ed = createEditor("<pre><code>plain</code></pre>");
    expect(languageSelect(ed).value).toBe("");
  });

  it("changing the select updates the node's language attr", () => {
    const ed = createEditor(JS_BLOCK);
    pickLanguage(languageSelect(ed), "python");
    expect(ed.state.doc.firstChild?.attrs.language).toBe("python");
    expect(ed.view.dom.querySelector("pre code")?.className).toBe("language-python");
    expect(languageSelect(ed).value).toBe("python");
    expect(Array.from(languageSelect(ed).options).map((o) => o.value)).not.toContain("js");
  });

  it("selecting auto clears the language", () => {
    const ed = createEditor(JS_BLOCK);
    pickLanguage(languageSelect(ed), "");
    expect(ed.state.doc.firstChild?.attrs.language).toBeNull();
    expect(ed.view.dom.querySelector("pre code")?.getAttribute("class")).toBe("");
  });

  it("re-highlights after the language changes", () => {
    const ed = createEditor('<pre><code class="language-plaintext">def f():\n  return 1</code></pre>');
    expect(ed.view.dom.querySelector("pre code .hljs-keyword")).toBeNull();
    pickLanguage(languageSelect(ed), "python");
    expect(ed.view.dom.querySelector("pre code .hljs-keyword")?.textContent).toBe("def");
  });

  it("reflects attr changes made elsewhere, such as from a collaborator", () => {
    const ed = createEditor(JS_BLOCK);
    ed.view.dispatch(
      ed.state.tr.setNodeMarkup(0, undefined, { ...ed.state.doc.firstChild!.attrs, language: "go" }),
    );
    expect(languageSelect(ed).value).toBe("go");
  });

  it("does not touch the document text", () => {
    const ed = createEditor(JS_BLOCK);
    pickLanguage(languageSelect(ed), "rust");
    expect(ed.getText()).toContain("const a = 1;");
    expect(ed.state.doc.childCount).toBe(2);
  });
});

describe("CodeBlock with the copy widget", () => {
  it("still renders the copy button inside pre, in the code content", () => {
    const ed = createEditor(JS_BLOCK);
    const pre = ed.view.dom.querySelector("pre")!;
    const button = pre.querySelector(".code-copy");
    expect(button).not.toBeNull();
    expect(pre.querySelector("code")?.contains(button)).toBe(true);
    expect(pre.querySelector("select.code-lang")).not.toBeNull();
  });

  it("keeps the copy button after a language change", () => {
    const ed = createEditor(JS_BLOCK);
    pickLanguage(languageSelect(ed), "typescript");
    expect(ed.view.dom.querySelector("pre code .code-copy")).not.toBeNull();
  });
});
