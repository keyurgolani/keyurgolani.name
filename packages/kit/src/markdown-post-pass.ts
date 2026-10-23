import { renderInlineMarkdown as renderInline, renderMarkdown as render } from './markdown';
import { sanitizeBlocks, sanitizeInline } from './markdown-sanitize';

// The renderer, then sanitize-html over its markup (markdown-sanitize.ts),
// for markdown.server.ts to export.

/** The renderers the post-pass runs after. A test swaps in a broken one to see the post-pass catch it. */
export const renderers = { block: render, inline: renderInline };

export function renderMarkdown(source: string | undefined | null): string {
  return sanitizeBlocks(renderers.block(source));
}

export function renderInlineMarkdown(source: string | undefined | null): string {
  return sanitizeInline(renderers.inline(source));
}
