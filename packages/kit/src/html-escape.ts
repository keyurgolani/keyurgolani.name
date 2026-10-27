// HTML escaping for the markdown renderer and RichText, which reads back the
// hrefs it writes. No entry point exports it.

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const UNESCAPES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ESCAPES).map(([char, reference]) => [reference, char]),
);

/** Every character that could be markup, as a reference: for code, raw HTML, and attribute values. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/** Text escapeHtml wrote, back as it was. */
export const unescapeHtml = (html: string) =>
  html.replace(/&(?:amp|lt|gt|quot|#39);/g, (reference) => UNESCAPES[reference]!);
