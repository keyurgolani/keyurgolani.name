import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, type Diagnostic } from '@portfolio/schema';
import { runImport } from './pipeline';
import { redactDiagnostic, schemaWords, UNKNOWN_KEY } from './redact';
import { CANARY, EXAMPLE, exampleData, pairFiles } from './test-support/hostile';

// The import's diagnostic redaction (#9, PR 3), on diagnostics built by
// hand: a key the schema doesn't name leaves no trace in the pointer, the
// message, the remediation, or the stableId, wherever #4 puts it, and keys
// the schema names stay.

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    code: 'schema.invalid',
    severity: 'blocks-preview',
    document: 'portfolio',
    pointer: '',
    message: 'A fixed message.',
    remediation: 'A fixed remediation.',
    ...overrides,
  };
}

const data = { portfolio: exampleData('portfolio'), site: exampleData('site') };

test('a message that names the key outside its pointer falls back to a fixed one at the redacted pointer', () => {
  const result = redactDiagnostic(
    diagnostic({
      pointer: `/identity/${CANARY}`,
      message: `The key "${CANARY}" at /identity/${CANARY} isn't a field here.`,
    }),
    data,
  );
  assert.equal(result.pointer, `/identity/${UNKNOWN_KEY}`);
  assert.equal(result.message, `There's a schema.invalid finding at /identity/${UNKNOWN_KEY}.`);
  assert.equal(JSON.stringify(result).includes(CANARY), false);
});

test('a message that names the key only as its pointer keeps its wording, with the pointer redacted', () => {
  const result = redactDiagnostic(
    diagnostic({
      pointer: `/identity/${CANARY}`,
      message: `/identity/${CANARY} isn't a field here.`,
    }),
    data,
  );
  assert.equal(result.message, `/identity/${UNKNOWN_KEY} isn't a field here.`);
});

test('a remediation or stableId that names the key is replaced, and a key spelled with a pointer escape is found too', () => {
  const slashed = `${CANARY}/x~y`;
  const result = redactDiagnostic(
    diagnostic({
      code: 'ref.missing',
      document: 'site',
      pointer: `/sections/${slashed.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      message: 'Fixed.',
      remediation: `Remove ${slashed} from the site document.`,
      stableId: slashed,
    }),
    data,
  );
  assert.equal(result.pointer, `/sections/${UNKNOWN_KEY}`);
  assert.equal(result.stableId, UNKNOWN_KEY);
  assert.equal(JSON.stringify(result).includes(CANARY), false);
  assert.match(result.remediation, /section id the portfolio has/);
});

test('a message naming a parent pointer that holds the key in its escaped spelling falls back too', () => {
  const key = `${CANARY}/a~b`;
  const spelled = `${CANARY}~1a~0b`;
  const result = redactDiagnostic(
    diagnostic({
      // Only the escaped spelling is in the message: the raw key isn't, and
      // neither is the last segment, so nothing else can find it.
      pointer: `/identity/${spelled}/q`,
      message: `/identity/${spelled} isn't a field here.`,
    }),
    data,
  );
  assert.equal(result.pointer, `/identity/${UNKNOWN_KEY}/${UNKNOWN_KEY}`);
  assert.equal(result.message, `There's a schema.invalid finding at ${result.pointer}.`);
  assert.equal(JSON.stringify(result).includes(CANARY), false);
  assert.equal(result.message.includes(key), false);
});

test('with no data, a key inside a union member stays when the schemas name it anywhere, and a file key does not', () => {
  const words = schemaWords();
  for (const word of ['identity', 'title', 'body', 'hidden', 'sections', 'enabled', 'values']) {
    assert.ok(words.has(word), word);
  }
  assert.equal(words.has(CANARY), false);
  const title = redactDiagnostic(
    diagnostic({ pointer: '/sections/0/title', message: 'At it.' }),
    {},
  );
  assert.equal(title.pointer, '/sections/0/title');
  const site = redactDiagnostic(
    diagnostic({ document: 'site', pointer: `/sections/${CANARY}/hidden`, message: 'At it.' }),
    {},
  );
  assert.equal(site.pointer, `/sections/${UNKNOWN_KEY}/hidden`);
});

test("an anchor in a section's title, in a file that does not parse, keeps its whole pointer", () => {
  const portfolio = exampleData('portfolio');
  const [first] = portfolio.sections as Record<string, unknown>[];
  first!.title = 'Anchored section title';
  const text = serialize(portfolio, 'yaml').replace(
    'title: Anchored section title',
    'title: &named Anchored section title',
  );
  assert.ok(text.includes('&named'));
  const result = runImport(pairFiles(text, EXAMPLE.site));
  assert.equal(result.kind === 'refused' && result.code, 'parse_limits');
  assert.deepEqual(
    result.diagnostics.map(({ pointer }) => pointer),
    ['/sections/0/title'],
  );
});

test('keys the schema names stay, an array index stays, and a diagnostic with nothing to redact is returned as it is', () => {
  const kept = diagnostic({
    pointer: '/works/0/summary',
    message: '/works/0/summary is too long.',
    stableId: 'postmortem-template-kit',
  });
  assert.equal(redactDiagnostic(kept, data), kept);
  const site = diagnostic({ document: 'site', pointer: '/appearance/colorScheme' });
  assert.equal(redactDiagnostic(site, data), site);
});

test('with no data, a pointer keeps only the keys the schema names and its indexes, and one that is not a pointer is replaced', () => {
  const result = redactDiagnostic(
    diagnostic({ pointer: `/works/3/${CANARY}/2`, message: 'Fixed.' }),
    {},
  );
  assert.equal(result.pointer, `/works/3/${UNKNOWN_KEY}/2`);
  const notPointer = redactDiagnostic(
    diagnostic({ pointer: `${CANARY}~9`, message: `At ${CANARY}~9.` }),
    data,
  );
  assert.equal(notPointer.pointer, UNKNOWN_KEY);
  assert.equal(JSON.stringify(notPointer).includes(CANARY), false);
  const media = redactDiagnostic(
    diagnostic({ document: 'media', pointer: `/assets/${CANARY}`, message: 'Fixed.' }),
    data,
  );
  assert.equal(media.pointer, `/${UNKNOWN_KEY}/${UNKNOWN_KEY}`);
});
