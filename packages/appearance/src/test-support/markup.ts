// Reading react-dom/server's markup in the package's own tests: each start
// tag with its attributes, in document order. React writes attributes
// double-quoted and escaped, so a small reader is enough, and the tests
// need no DOM library.

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export interface Element {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** Where its start tag begins in the markup. */
  readonly index: number;
}

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:="([^"]*)")?/g;

const unescape = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every start tag in `markup`. */
export function elements(markup: string): Element[] {
  return [...markup.matchAll(START_TAG)].map((match) => ({
    tag: match[1]!.toLowerCase(),
    index: match.index!,
    attributes: Object.fromEntries(
      // HTML's attribute names are case-insensitive; React writes some camel-cased, as srcSet.
      [...match[2]!.matchAll(ATTRIBUTE)].map((attribute) => [
        attribute[1]!.toLowerCase(),
        unescape(attribute[2] ?? ''),
      ]),
    ),
  }));
}

/** The elements whose data-ui-slot is `slot`. */
export function slotted(markup: string, slot: string): Element[] {
  return elements(markup).filter((element) => element.attributes['data-ui-slot'] === slot);
}

/** The one element whose data-ui-slot is `slot`; it fails unless there's exactly one. */
export function one(markup: string, slot: string): Element {
  const found = slotted(markup, slot);
  if (found.length !== 1) {
    throw new Error(`Expected one [data-ui-slot="${slot}"], found ${found.length} in ${markup}`);
  }
  return found[0]!;
}

/** Every data-ui-slot value in `markup`, in document order. */
export function slotValues(markup: string): string[] {
  return elements(markup)
    .map((element) => element.attributes['data-ui-slot'])
    .filter((slot): slot is string => slot !== undefined);
}

/** Every id in `markup`. */
export function ids(markup: string): string[] {
  return elements(markup)
    .map((element) => element.attributes.id)
    .filter((id): id is string => id !== undefined);
}

/** The markup react-dom/server renders for `node`. */
export function html(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

/** The text of `markup` with its tags removed, whitespace collapsed. */
export function text(markup: string): string {
  return unescape(markup.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
