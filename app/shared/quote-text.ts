/**
 * `read_document` hands agents each block as markdown, so a quote or `find`
 * copied from it carries inline syntax — backticks, emphasis, link
 * brackets — that the document's text itself does not have. Strip that
 * syntax so the copied string matches the words on the page (#90).
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url), ![alt](src) → text
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2") // **bold**, __bold__
    .replace(/\*(?=\S)([^*]*?\S)\*/g, "$1") // *em*
    .replace(/(^|[^A-Za-z0-9])_(?=\S)([^_]*?\S)_(?![A-Za-z0-9])/g, "$1$2") // _em_, but not snake_case
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1") // ~~strike~~
    .replace(/`([^`]*)`/g, "$1") // `code`
    .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, "$1"); // \[ escaped punctuation
}
