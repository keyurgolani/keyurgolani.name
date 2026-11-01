import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { relationsOf, repoKey, type Relations } from './model';
import { intends, INTENT_MS, litKeys, sourceOf } from './enhancements/correlate';
import { fixtureInput, inputFor, PACKAGE_DIR, pairOf, sampleInput } from './__tests__/harness.test';

// Correlate's relation model (brief §5.8, MC-M4): one hop, both ways, only
// through fields that name another record, and only between records on the
// page. Then the enhancement's pure parts: which keys a source lights,
// which pointers carry hover intent, and that the pin wins over a hover.

const ALL_KINDS = ['works', 'evidence', 'chronology', 'github'];

const named = (relations: Relations, id: string) => [...(relations.names.get(id) ?? [])].sort();

/** A portfolio whose records name each other through every field the model reads. */
function linkedPair(controls?: Record<string, unknown>) {
  return inputFor(
    pairOf(
      {
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Ana Ruiz', tagline: 'Engineer' },
        works: [
          {
            id: 'kit',
            title: 'Template kit',
            medium: 'software',
            evidence: ['prize', 'missing-record'],
            links: [{ label: 'Source', url: 'https://code.test/ana/kit/' }],
          },
          { id: 'talk-notes', title: 'Talk notes', medium: 'writing' },
          { id: 'hidden-work', title: 'Hidden work', medium: 'software', evidence: ['prize'] },
        ],
        evidence: [
          { id: 'prize', type: 'award', title: 'Practitioner prize', receivedAt: '2024-05-01' },
          {
            id: 'voice',
            type: 'testimonial',
            statement: 'She made the incident reviews worth reading.',
            source: { name: 'Mira Anand', organization: 'Solstice' },
          },
          {
            id: 'stranger',
            type: 'testimonial',
            statement: 'Kind and clear.',
            source: { name: 'Lee Park', organization: 'Elsewhere' },
          },
        ],
        chronology: [
          {
            id: 'role',
            kind: 'role',
            title: 'Principal engineer',
            organization: 'Solstice',
            period: { start: '2022-01' },
            works: ['kit', 'nowhere'],
          },
          {
            id: 'side',
            kind: 'project',
            title: 'Side project',
            period: { start: '2023-01' },
            branchesFrom: 'role',
          },
        ],
        sections: [
          { kind: 'works', id: 'work', title: 'Work', items: ['kit', 'talk-notes'] },
          { kind: 'evidence', id: 'record', title: 'Record', items: ['prize'] },
          { kind: 'evidence', id: 'voices', title: 'Voices', items: ['voice', 'stranger'] },
          { kind: 'chronology', id: 'path', title: 'Path', items: ['role', 'side'] },
        ],
      },
      controls,
    ),
  );
}

test('relations run one hop, both ways, through the fields that name a record', () => {
  const relations = relationsOf(linkedPair(), ALL_KINDS);
  // A work names its evidence; a role names its works, what branches from it, and the voices from its organization.
  assert.deepEqual(named(relations, 'kit'), ['prize', 'role']);
  assert.deepEqual(named(relations, 'prize'), ['kit']);
  assert.deepEqual(named(relations, 'role'), ['kit', 'side', 'voice']);
  assert.deepEqual(named(relations, 'side'), ['role']);
  assert.deepEqual(named(relations, 'voice'), ['role']);
  // One hop: the prize doesn't name the role through the kit.
  assert.ok(!named(relations, 'prize').includes('role'));
  // A record naming nothing on the page carries nothing; ids that name no record are dropped.
  assert.equal(relations.names.has('talk-notes'), false);
  assert.equal(relations.names.has('stranger'), false);
  for (const list of relations.names.values()) {
    assert.ok(!list.includes('missing-record') && !list.includes('nowhere'));
  }
  // A work no section shows names nothing and is named by nothing.
  assert.equal(relations.names.has('hidden-work'), false);
  assert.ok(![...relations.names.values()].some((list) => list.includes('hidden-work')));
});

test('every relation is mutual, and every named record has words and a place on the page', () => {
  for (const input of [linkedPair(), sampleInput(), fixtureInput('complete')]) {
    const relations = relationsOf(input, ALL_KINDS);
    for (const [id, list] of relations.names) {
      assert.ok(relations.labels.get(id)?.text, id);
      for (const other of list) {
        assert.ok(relations.names.get(other)?.includes(id), `${other} names ${id} back`);
        const label = relations.labels.get(other);
        assert.ok(label && label.text.trim() !== '', other);
        assert.ok(label.href?.startsWith(`#${input.ids.prefix}`), other);
      }
    }
  }
});

test('the labels say who a voice is and where a role was, never a schema word', () => {
  const relations = relationsOf(linkedPair(), ALL_KINDS);
  assert.equal(relations.labels.get('voice')?.text, 'Mira Anand, Solstice');
  assert.equal(relations.labels.get('role')?.text, 'Principal engineer, Solstice');
  assert.equal(relations.labels.get('prize')?.text, 'Practitioner prize');
});

test('only the kinds the wall marks take part, so nothing names a record that carries no mark', () => {
  // Every kind with records is marked now (P2); a narrower set leaves the rest out.
  assert.deepEqual(named(relationsOf(linkedPair()), 'kit'), ['prize', 'role']);
  const narrow = relationsOf(linkedPair(), ['works', 'evidence']);
  assert.deepEqual(named(narrow, 'kit'), ['prize']);
  assert.equal(narrow.names.has('role'), false);
});

test('a repository in the snapshot is named by the work whose link is its address', () => {
  const input = fixtureInput('complete');
  const relations = relationsOf(input, ALL_KINDS);
  const repos = [...relations.names.keys()].filter((id) => id.startsWith(repoKey('')));
  for (const repo of repos) {
    for (const work of relations.names.get(repo)!) {
      assert.ok(
        input.portfolio.works.some(({ id }) => id === work),
        `${repo} names a work`,
      );
    }
    assert.equal(relations.labels.get(repo)?.kind, 'Repository');
  }
});

test('correlate off: no relations, so no record carries a mark', () => {
  const relations = relationsOf(linkedPair({ correlate: false }), ALL_KINDS);
  assert.equal(relations.names.size, 0);
});

test('a source lights itself and what it names; only a fine hovering mouse or pen intends; the pin wins', () => {
  assert.deepEqual([...litKeys('kit', 'prize  role')].sort(), ['kit', 'prize', 'role']);
  assert.deepEqual([...litKeys('kit', undefined)], ['kit']);
  assert.equal(INTENT_MS, 220);
  assert.equal(intends('mouse', true), true);
  assert.equal(intends('pen', true), true);
  assert.equal(intends('touch', true), false);
  assert.equal(intends('mouse', false), false);
  assert.equal(sourceOf('pin', 'hover'), 'pin');
  assert.equal(sourceOf(undefined, 'hover'), 'hover');
  assert.equal(sourceOf(undefined, undefined), undefined);
});

test('focus alone lights nothing: the enhancement listens for no focus, and runs no frame loop', () => {
  const source = readFileSync(
    path.join(PACKAGE_DIR, 'src', 'enhancements', 'correlate.tsx'),
    'utf8',
  ).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(source, /['"]focus(?:in|out)?['"]/);
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval/);
});
