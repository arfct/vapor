import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { common, createLowlight } from "lowlight";

// `common` (~35 grammars) rather than `all`: the full set is several MB.
const lowlight = createLowlight(common);

/** Languages the selector offers, alphabetised. */
export const CODE_LANGUAGES: readonly string[] = lowlight.listLanguages().sort();

function languageOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function createLanguageSelect(onChange: (language: string | null) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "code-lang";
  select.contentEditable = "false";
  select.setAttribute("aria-label", "Code language");
  select.title = "Code language";
  select.appendChild(languageOption("", "auto"));
  for (const language of CODE_LANGUAGES) select.appendChild(languageOption(language, language));

  // The editor wrapper focuses the editor on click; that would steal focus
  // from the open control. Same guard as the copy button.
  for (const type of ["mousedown", "click"]) {
    select.addEventListener(type, (event) => event.stopPropagation());
  }
  select.addEventListener("change", () => onChange(select.value || null));
  return select;
}

/**
 * Shows `language` in the select. Fence info strings can be aliases or
 * names outside the `common` set ("js", "dockerfile"); those get a
 * temporary option so the control reflects the document instead of
 * silently showing "auto".
 */
function showLanguage(select: HTMLSelectElement, language: string | null) {
  const value = language ?? "";
  select.querySelector("option[data-extra]")?.remove();
  if (value && !CODE_LANGUAGES.includes(value)) {
    const extra = languageOption(value, value);
    extra.dataset.extra = "true";
    select.appendChild(extra);
  }
  select.value = value;
}

/**
 * Code blocks with lowlight syntax highlighting (`hljs-*` classes, themed
 * in app.css) and a language selector in the block's corner.
 *
 * The node view keeps StarterKit's `<pre><code>` shape with `<code>` as
 * the content DOM, so the copy widget (code-block-copy.ts) still lands
 * inside `pre`. Picking a language dispatches a normal ProseMirror
 * transaction on the `language` attr, so it syncs over Yjs and
 * round-trips to the fence info string.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor, HTMLAttributes }) => {
      const pre = document.createElement("pre");
      for (const [name, value] of Object.entries(HTMLAttributes)) {
        pre.setAttribute(name, String(value));
      }
      const code = document.createElement("code");

      const select = createLanguageSelect((language) => {
        const pos = getPos();
        if (pos === undefined) return;
        const block = editor.state.doc.nodeAt(pos);
        if (block?.type !== node.type) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...block.attrs, language }),
        );
      });

      const showBlock = (block: ProseMirrorNode) => {
        const language = block.attrs.language as string | null;
        code.className = language ? `${this.options.languageClassPrefix}${language}` : "";
        showLanguage(select, language);
      };
      showBlock(node);
      pre.appendChild(select);
      pre.appendChild(code);

      return {
        dom: pre,
        contentDOM: code,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          showBlock(updated);
          return true;
        },
        // The select is UI, not content: ProseMirror must neither handle
        // its events nor re-read the node when its options change.
        stopEvent: (event) => select.contains(event.target as Node),
        ignoreMutation: (mutation) => !code.contains(mutation.target),
      };
    };
  },
}).configure({ lowlight });
