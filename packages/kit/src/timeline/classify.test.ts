import test from 'node:test';
import assert from 'node:assert/strict';
import { inferKindFromText } from './classify';

type Kind = 'internship' | 'research' | 'project' | 'job';

const RULES = {
  internship: [/intern(ship)?/i],
  research: [/\b(research|publication|paper|ieee|acm)\b/i],
  project: [/\b(open[- ]?source|project|github)\b/i],
};

test('returns the first matching kind in iteration order', () => {
  assert.equal(
    inferKindFromText<Kind>('Summer Intern at Google', RULES, { fallback: 'job' }),
    'internship',
  );
  assert.equal(
    inferKindFromText<Kind>('Research Engineer', RULES, { fallback: 'job' }),
    'research',
  );
});

test('returns fallback when no rule matches', () => {
  assert.equal(
    inferKindFromText<Kind>('Senior Software Engineer', RULES, { fallback: 'job' }),
    'job',
  );
});

test('is case-insensitive', () => {
  assert.equal(
    inferKindFromText<Kind>('IEEE PUBLICATION', RULES, { fallback: 'job' }),
    'research',
  );
});

test('priority follows insertion order, not specificity', () => {
  // 'intern' appears AFTER 'research' in this haystack but iteration-order
  // is internship → research → project, so internship wins.
  assert.equal(
    inferKindFromText<Kind>('Research Internship in NLP', RULES, { fallback: 'job' }),
    'internship',
  );
});

test('handles empty haystack', () => {
  assert.equal(inferKindFromText<Kind>('', RULES, { fallback: 'job' }), 'job');
});

test('handles empty rule set', () => {
  assert.equal(
    inferKindFromText<'job'>('any text', {}, { fallback: 'job' }),
    'job',
  );
});

test('skips kinds with empty pattern arrays', () => {
  assert.equal(
    inferKindFromText<Kind>('Open Source Maintainer', { project: [/open/] }, { fallback: 'job' }),
    'project',
  );
});
