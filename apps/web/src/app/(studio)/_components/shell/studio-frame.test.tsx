import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_TASKS, STUDIO_TASKS, type StudioTask } from '~/lib/studio/tasks';
import { StudioFrame } from './studio-frame';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Where Studio's frame says it needs JavaScript (#8, #9): at the Content
// task's anchor in both Studios, since a visitor who lands with no script
// reads it there, and at the first task's when a list has no Content task.

const NOTICE = 'Studio needs JavaScript.';

/** The id of the one anchor holding the <noscript> notice, and every anchor's id in order. */
function notice(tasks: readonly StudioTask[]) {
  const html = renderToStaticMarkup(
    <StudioFrame
      status={null}
      tasks={tasks}
      current={tasks[0]?.id}
      noScript={<p>{NOTICE}</p>}
      state={null}
    />,
  );
  const anchors = /<div class="studio-shell__anchors">([\s\S]*?)<\/div><section/.exec(html)?.[1];
  assert.ok(anchors, 'the anchors');
  const holders = [...anchors.matchAll(/<div id="([^"]+)" tabindex="-1"><noscript>/g)].map(
    ([, id]) => id,
  );
  const ids = [...anchors.matchAll(/id="([^"]+)"/g)].map(([, id]) => id);
  assert.equal((html.match(/<noscript>/g) ?? []).length, 1, 'one notice');
  assert.ok(html.includes(NOTICE));
  return { holders, ids };
}

test("Owner Studio's notice is at #content, its first task", () => {
  const { holders, ids } = notice(STUDIO_TASKS);
  assert.deepEqual(holders, ['content']);
  assert.equal(ids.indexOf('content'), 0);
});

test("Demo Studio's notice is at #content, not at its first task, #appearance", () => {
  const { holders, ids } = notice(DEMO_TASKS);
  assert.deepEqual(holders, ['content']);
  assert.equal(ids[0], 'appearance');
  assert.ok(ids.includes('appearance'));
});

test('a task list with no Content task has its notice at its first task', () => {
  const tasks = DEMO_TASKS.filter((task) => task.id !== 'content');
  const { holders } = notice(tasks);
  assert.deepEqual(holders, [tasks[0]!.id]);
  assert.equal(holders[0], 'appearance');
});
