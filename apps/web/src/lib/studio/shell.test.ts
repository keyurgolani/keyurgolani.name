import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endSession, NEUTRAL_TITLE } from './session-end';
import { STUDIO_TASKS, tasksFor } from './tasks';

// The Studio shell's pieces outside React (#8, Slice 1): the seven tasks and
// the policy that lists them, the order a session ends in, and Studio's
// isolation from what the public site reads.

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test("the navigation covers the owner's seven tasks, each behind a capability", () => {
  assert.deepEqual(
    STUDIO_TASKS.map((task) => task.label),
    [
      'Content',
      'Case studies and artifacts',
      'Media',
      'Appearance',
      'Site behavior',
      'Validation',
      'Publish history',
    ],
  );
  // Each task a later pull request builds says so, in words.
  for (const task of STUDIO_TASKS.filter((each) => each.pending)) {
    assert.match(task.pending!, /arrives? with (?:the next|a later) Studio release/, task.id);
  }
  assert.deepEqual(
    tasksFor(['draft.read']).map((task) => task.id),
    ['content', 'case-studies', 'validation'],
  );
  assert.deepEqual(tasksFor([]), []);
});

test('an ended session keeps the journal first, then drops the page, names nothing, and goes to sign-in with returnTo', () => {
  const calls: string[] = [];
  endSession(
    {
      flush: () => calls.push('flush'),
      drop: () => calls.push('drop'),
      setTitle: (title) => calls.push(`title ${title}`),
      here: () => '/studio#content',
      navigate: (location) => calls.push(`go ${location}`),
    },
    'session_ended',
  );
  assert.deepEqual(calls, [
    'flush',
    'drop',
    `title ${NEUTRAL_TITLE}`,
    'go /studio/sign-in?state=session_ended&returnTo=%2Fstudio%23content',
  ]);
});

/** Every Studio source file the browser loads: the route group and lib/studio, tests aside. */
function studioSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(?:tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push({ file: path.relative(WEB, file), text: readFileSync(file, 'utf8') });
      }
    }
  };
  walk(path.join(WEB, 'src', 'app', '(studio)'));
  walk(path.join(WEB, 'src', 'lib', 'studio'));
  return out;
}

test("Studio writes no cookie and no key the public site reads, and never the visitor's appearance preference", () => {
  const forbidden: [RegExp, string][] = [
    [/document\.cookie/, 'a cookie written from script'],
    [/\/api\/appearance/, "the visitor's appearance preference"],
    [/APPEARANCE_COOKIE|portfolio_appearance/, "the visitor's appearance cookie"],
    [/portfolio:theme/, "v1's theme key, which the public script read"],
    [/PAUSE_KEY|portfolio\.motion\.paused/, "the kit's motion pause key"],
  ];
  const found = studioSources().flatMap(({ file, text }) =>
    forbidden.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${file}: ${what}`),
  );
  assert.deepEqual(found, []);
  // The keys Studio does write are its own.
  const keys = studioSources().flatMap(({ text }) =>
    [
      ...text.matchAll(
        /\b(?:localStorage|sessionStorage|storage)\.(?:getItem|setItem|removeItem)\(\s*([A-Z_]+|'[^']*')/g,
      ),
    ].map(([, key]) => key!),
  );
  assert.ok(keys.length > 0);
  for (const key of keys)
    assert.match(key, /^(?:LEFT_GRANTS_KEY|JOURNAL_KEY|'studio\.[^']*')$/, key);
});
