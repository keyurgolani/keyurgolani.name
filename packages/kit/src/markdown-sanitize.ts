import sanitizeHtml from 'sanitize-html';
import { isAllowedUrl } from '@portfolio/schema';
import { decodeReferences } from './html-references';

// sanitize-html over the markup the Markdown renderer writes (#10), a second
// pass with the renderer's own allowlist: block p, a, em, strong, code, pre,
// ul, ol, li, blockquote, h3 to h6, br, and hr, and inline a, em, strong,
// code, and br. The one attribute is href on a, and #4's link rule decides
// it, on the URL a browser reads from the attribute, through the hook below;
// sanitize-html's own scheme list judges nothing, so the two rules can't
// drift apart.
//
// The renderer already writes nothing else, so the pass leaves its markup as
// it is, byte for byte: entities pass as written, and br and hr keep the
// renderer's form. What it changes is what a regression in the renderer
// would let through. It runs where React Server Components render
// (markdown.server.ts); sanitize-html and the parser it brings weigh about
// 58 KB gzipped, more than the renderer itself, so browser bundles don't
// carry it.

const INLINE = ['a', 'em', 'strong', 'code', 'br'];
const BLOCK = [...INLINE, 'p', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'h5', 'h6', 'hr'];

/**
 * An a keeps its href when #4's link rule allows the URL a browser reads
 * from it, and otherwise stays with none, so it goes nowhere. It isn't
 * renamed to a tag the allowlist drops: sanitize-html 2.18 then writes the
 * next element's closing tag with that name.
 */
function link(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Transformed {
  // The hook decides href alone; allowedAttributes drops the rest.
  const { href, ...rest } = attribs;
  const allowed = href !== undefined && isAllowedUrl(decodeReferences(href));
  return { tagName, attribs: allowed ? { ...rest, href } : rest };
}

function options(allowedTags: string[]): sanitizeHtml.Options {
  return {
    allowedTags,
    allowedAttributes: { a: ['href'] },
    allowedClasses: {},
    allowedStyles: {},
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    allowVulnerableTags: false,
    disallowedTagsMode: 'discard',
    // The markup's entities pass as written, and the hook decodes href itself.
    parser: { decodeEntities: false },
    transformTags: { a: link },
  };
}

const BLOCK_OPTIONS = options(BLOCK);
const INLINE_OPTIONS = options(INLINE);

/** sanitize-html writes a void element as `<br />`; the renderer writes `<br>`. */
const voids = (html: string) => html.replace(/<(br|hr) \/>/g, '<$1>');

/** renderMarkdown's markup through the block allowlist. */
export function sanitizeBlocks(html: string): string {
  return html ? voids(sanitizeHtml(html, BLOCK_OPTIONS)) : html;
}

/** renderInlineMarkdown's markup through the inline allowlist. */
export function sanitizeInline(html: string): string {
  return html ? voids(sanitizeHtml(html, INLINE_OPTIONS)) : html;
}
