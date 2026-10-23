// @portfolio/kit/markdown under the react-server condition (#10): the
// browser-safe renderer, then sanitize-html over its markup with the same
// allowlist (markdown-post-pass.ts, markdown-sanitize.ts). React Server
// Components resolve to this, which is where the site's sections render
// Markdown, #7's preview frame included. A client component, in its server
// render and in the browser, gets markdown.ts alone: today that's render
// parity's test render, and later #9's in-browser render. So no browser
// bundle carries sanitize-html (ci/check-markdown-pass.mjs checks the build,
// and markdown-clients.test.ts lists the client modules that reach it).

export { renderInlineMarkdown, renderMarkdown } from './markdown-post-pass';
