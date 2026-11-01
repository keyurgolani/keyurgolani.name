import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The kit runtime's pause in experience-base.css (#6, items 6 and 7; OWN-1):
// a runtime root that isn't active pauses the ambient loops below it through
// --motion-ambient-state, which every loop reads as its play-state, and
// nothing else. A pause of every animation held Horizontal Cinema's title
// card half open, its name at opacity 0, in an Owner Studio frame that was
// visible but not focused, so the host never sets animation-play-state.

const css = readFileSync(fileURLToPath(new URL('./experience-base.css', import.meta.url)), 'utf8');
const text = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Each rule's selector list and its declarations, outermost blocks unwrapped. */
function rules(source: string): { selectors: string[]; body: string }[] {
  const found: { selectors: string[]; body: string }[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = match[1]!.trim();
    if (prelude.startsWith('@')) continue;
    found.push({
      selectors: prelude.split(',').map((selector) => selector.trim()),
      body: match[2]!.trim(),
    });
  }
  return found;
}

test('a paused runtime root pauses ambient loops through the state, and only that', () => {
  const paused = rules(text).filter(({ selectors }) =>
    selectors.some((selector) => selector.includes("[data-activity='paused']")),
  );
  assert.deepEqual(paused, [
    { selectors: ["[data-activity='paused']"], body: '--motion-ambient-state: paused;' },
  ]);
});

test('the host stylesheet never sets animation-play-state, so a one-shot entrance always plays to its end', () => {
  assert.doesNotMatch(text, /animation-play-state/);
  // Nor a universal selector below the runtime's attribute, which would reach every entrance.
  assert.doesNotMatch(text, /\[data-activity[^\]]*\]\s*\*/);
});
