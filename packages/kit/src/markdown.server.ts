// @portfolio/kit/markdown under the react-server condition (#10): the
// browser-safe renderer, then sanitize-html over its markup with the same
// allowlist (markdown-post-pass.ts, markdown-sanitize.ts). React Server
// Components resolve to this, which is where the site's sections render
// Markdown. A client component, in its server render and in the browser,
// gets markdown.ts alone, as do #7's preview frame and #9's browser render,
// so no browser bundle carries sanitize-html.

export { renderInlineMarkdown, renderMarkdown } from './markdown-post-pass';
