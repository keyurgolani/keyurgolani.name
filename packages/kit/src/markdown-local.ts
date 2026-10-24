/// <reference path="./sanitize-html.d.ts" />
import { requireMarkdownPostPass, setMarkdownPostPass } from './markdown';

// The browser's Markdown post-pass (#9, #10), for Demo Studio's local
// preview frame alone: it renders a visitor's own imported document in the
// browser, where markdown.server.ts never runs, so the frame installs the
// server's own pass, markdown-sanitize.ts with #10's allowlist and #4's link
// rule, exactly as that module exports it. It loads in a chunk of its own,
// on demand, and until it's in, the renderer gives nothing
// (markdown.ts). It installs once per document and stays. Only a browser
// may install it, so no server render ever has it: the server runs its own.

let installing: Promise<void> | null = null;

function inBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('The local Markdown post-pass installs in a browser alone.');
  }
}

/** Markdown renders nothing in this document until the post-pass is installed. */
export function requirePostPass(): void {
  inBrowser();
  requireMarkdownPostPass();
}

/**
 * Loads markdown-sanitize.ts's pass and installs it, once: a second call
 * gets the first's promise. A chunk that fails to load leaves Markdown
 * rendering nothing, and the promise rejects.
 */
export function installPostPass(): Promise<void> {
  requirePostPass();
  installing ??= import('./markdown-sanitize').then(({ sanitizeBlocks, sanitizeInline }) =>
    setMarkdownPostPass({ block: sanitizeBlocks, inline: sanitizeInline }),
  );
  return installing;
}
