import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Diagnostic, ParsedPair } from '@portfolio/schema';
import { loadPair } from '@portfolio/schema/node';
import {
  compatibilityFor,
  FALLBACK_ID,
  MISSING_VARIANT_ID,
  UNIT_CODES,
  type RegisteredVariant,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES } from '@portfolio/variant-contract/node';
import { EXTENSION_RENDERED_KINDS } from './generated/registry.extensions';
import { CONTENT_EXTENSIONS, liveContext, REGISTRY } from './variants';

// Every composition this build registers, on every contract fixture (#5,
// Slices 5 and 6): what the compatibility report says, as #3's publish checks
// it. Each finding says whether it blocks preview or publishing, says what to
// do, and points where the owner makes the change. Each visible kind gets the
// renderer the manifest says. The fallback composition renders every fixture
// with nothing to report but that it stands in. pnpm test:external-variant
// runs this file in its worktree, where the reference variant is registered
// too.

const { catalog } = liveContext();

/** The fixture's pair, its site selecting what reaches `variant`: its id, or missing-variant for the fallback. */
function pairFor(
  fixture: (typeof CONTRACT_FIXTURES)[number],
  variant: RegisteredVariant,
): ParsedPair {
  const loaded = loadPair(path.dirname(fixture.files.portfolio), { catalog });
  assert.ok(loaded.ok, `${fixture.name}: ${JSON.stringify(loaded.diagnostics)}`);
  const id = variant.manifest.id === FALLBACK_ID ? MISSING_VARIANT_ID : variant.manifest.id;
  const { pair } = loaded;
  return { ...pair, site: { ...pair.site, appearance: { ...pair.site.appearance, variant: id } } };
}

/** Whether `pointer` names something in `document`. */
function resolves(document: unknown, pointer: string): boolean {
  let value = document;
  for (const part of pointer.split('/').slice(1)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

/** Where a finding points: at what it's about, or, for an empty slot, where its content goes. */
function located(pair: ParsedPair, { code, document, pointer }: Diagnostic): boolean {
  const target = document === 'site' ? pair.site : pair.portfolio;
  if (resolves(target, pointer)) return true;
  return code.endsWith('-empty') && resolves(target, pointer.replace(/\/[^/]*$/, ''));
}

const CONSEQUENCE = {
  'blocks-publish': 'It blocks publishing, not preview.',
  warning: 'It blocks neither preview nor publishing.',
} as const;

for (const variant of REGISTRY) {
  const { manifest } = variant;
  for (const fixture of CONTRACT_FIXTURES) {
    test(`${manifest.id} on ${fixture.name}`, (t) => {
      const pair = pairFor(fixture, variant);
      const report = compatibilityFor(pair, {
        registry: REGISTRY,
        extensions: CONTENT_EXTENSIONS,
        extensionRenderers: EXTENSION_RENDERED_KINDS,
      });
      assert.equal(report.variant.rendered, manifest.id);

      for (const { kind, renderer } of report.kinds) {
        const expected = manifest.renderedKinds.includes(kind)
          ? 'bespoke'
          : manifest.unsupportedKinds.includes(kind)
            ? 'unsupported'
            : kind.startsWith('@')
              ? EXTENSION_RENDERED_KINDS.includes(kind)
                ? 'extension'
                : 'none'
              : 'shared';
        assert.equal(renderer, expected, kind);
      }

      for (const finding of report.diagnostics) {
        const severity = UNIT_CODES[finding.code as keyof typeof UNIT_CODES];
        assert.ok(severity, `${finding.code} is a compatibility code`);
        assert.equal(finding.severity, severity, finding.code);
        assert.ok(finding.message.endsWith(CONSEQUENCE[severity]), finding.message);
        assert.ok(finding.remediation.trim(), `${finding.code} says what to do`);
        assert.ok(
          located(pair, finding),
          `${finding.code} points at ${finding.document} ${finding.pointer}`,
        );
      }

      const codes = report.diagnostics.map(({ code }) => code);
      if (manifest.id === FALLBACK_ID) {
        // It stands in for the selection, and renders everything else as it is.
        assert.deepEqual(codes, ['variant.unavailable']);
        assert.equal(report.status, 'blocks-publish');
      } else {
        assert.ok(!codes.includes('variant.unavailable'), `${manifest.id} is registered`);
      }
      t.diagnostic(`${report.status}: ${codes.join(', ') || 'nothing to report'}`);
    });
  }
}
