import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import {
  CHECKLIST_VERSION,
  checklist,
  checklistItems,
  FLASH_ITEM,
  formattedRecordTemplate,
  NONE_REGISTERED,
  recordTemplate,
  registeredCompositions,
  templateFile,
} from './checklist';
import { manualRunProblems, repositoryManualRunContext } from './lib/manual-runs';
import { loadRegistrations, type Registrations } from './lib/registration';
import { judge } from './meta/cases';
import { filled, MANUAL_RUN_CASES } from './meta/manual-run-cases';

let registrations: Registrations;
let compositions: string[];
test.before(async () => {
  registrations = await loadRegistrations();
  compositions = await registeredCompositions();
});

test("a surface's checklist covers its routes in each state, its interactions, its primary actions, and the flash check", () => {
  const text = checklist('login', registrations, compositions);
  assert.match(text, /^# Manual checklist: login \(surface\)$/m);
  assert.match(text, new RegExp(`^Checklist version ${CHECKLIST_VERSION}\\.`, 'm'));
  for (const path of [
    '/studio/sign-in (signed-out)',
    '/studio/sign-in?state=failed (failed)',
    '/studio/sign-in?state=rate_limited&retryAfter=30 (rate-limited)',
  ]) {
    assert.ok(text.includes(`- [ ] ${path}:`), path);
  }
  assert.match(text, /- \[ \] Use "Sign in" on \/studio\/sign-in: the live region announces it/);
  assert.match(text, /- \[ \] Toggle "Show password" on \/studio\/sign-in/);
  assert.match(text, /- \[ \] "Sign in" is at least 44x44 CSS px to touch/);
  assert.ok(text.includes(`- [ ] ${FLASH_ITEM} (\`flash\`)`));
  assert.match(FLASH_ITEM, /WCAG 2\.3\.1/);
  // What the record keeps, and where.
  assert.match(
    text,
    /browser, assistive technology, and OS with versions, the viewport, the date, the tester/,
  );
  assert.match(text, /any exception it links/);
  assert.ok(text.includes('quality/manual-runs/templates/login.voiceover-safari-macos.yml'));
});

test("a composition's checklist covers its routes and every state fixture", () => {
  const text = checklist('fallback', registrations, compositions);
  assert.match(text, /^# Manual checklist: fallback \(composition\)$/m);
  assert.ok(text.includes('- [ ] / (complete):'));
  assert.ok(text.includes('- [ ] /work/project-name (missing-media):'));
  assert.ok(text.includes(NONE_REGISTERED));
  // It never tells the tester a page has no dialog or disclosure, which Kinetic Cosmos's has.
  assert.doesNotMatch(text, /has no dialog/);
  assert.ok(text.includes(FLASH_ITEM));
});

test('every item has an id, once, which a record answers it by', () => {
  for (const id of ['login', 'fallback']) {
    const items = checklistItems(id, registrations, compositions);
    const ids = items.map((item) => item.id);
    assert.deepEqual(ids, [...new Set(ids)], id);
    assert.equal(ids.at(-1), 'flash');
    for (const item of items)
      assert.ok(checklist(id, registrations, compositions).includes(`(\`${item.id}\`)`));
  }
  assert.deepEqual(
    checklistItems('login', registrations, compositions)
      .map((item) => item.id)
      .slice(0, 2),
    ['page:/studio/sign-in:signed-out', 'page:/studio/sign-in:failed'],
  );
});

test('an id nothing registers fails, naming what is registered', () => {
  assert.deepEqual(compositions, ['fallback', 'kinetic-cosmos', 'spatial-bento']);
  assert.throws(
    () => checklist('studio', registrations, compositions),
    /Nothing registers studio\. Registered: login, fallback, kinetic-cosmos, spatial-bento\./,
  );
});

test("each registered surface and composition has a committed VoiceOver with Safari template, the generator's own output", async () => {
  const context = await repositoryManualRunContext();
  for (const id of [...registrations.surfaces.map((surface) => surface.id), ...compositions]) {
    const committed = readFileSync(templateFile(id), 'utf8');
    const generated = recordTemplate(id, registrations, compositions);
    // What --record prints is the committed file, byte for byte, as Prettier formats it.
    assert.equal(await formattedRecordTemplate(id, registrations, compositions), committed, id);
    assert.deepEqual(parse(committed), parse(generated), id);
    const record = parse(committed) as Record<string, unknown> & {
      browser: { name: string };
      assistiveTechnology: { name: string };
      os: { name: string };
    };
    assert.deepEqual(
      [record.browser.name, record.assistiveTechnology.name, record.os.name],
      ['Safari', 'VoiceOver', 'macOS'],
    );
    // As it stands it's no record; filled in, it is.
    assert.match(
      manualRunProblems(`${id}-2026-10-23-safari-voiceover.yml`, committed, context)[0]!,
      /is still a template/,
    );
    assert.deepEqual(
      manualRunProblems(
        `${id}-2026-10-23-safari-voiceover.yml`,
        JSON.stringify(filled(committed)),
        { ...context, today: '2026-10-24' },
      ),
      [],
    );
  }
});

test('each manual-run case goes the way it should', async () => {
  for (const metaCase of MANUAL_RUN_CASES) {
    assert.equal(judge(metaCase, await metaCase.run()), null, metaCase.id);
  }
});
