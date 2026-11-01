import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceSelection } from '@portfolio/schema';
import {
  appearanceCredits,
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  resolveAppearance,
} from './index';
import { HUMANIST_UI, PLATFORM_NEUTRAL, testRegistry, WARM_PARCHMENT } from './test-support/packs';

const registry = testRegistry();

const resolve = (published: AppearanceSelection) =>
  resolveAppearance({
    published,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry,
  });

test("the credits are the packs that render, each by its registered id and its manifest's name (contract 2.1)", () => {
  const credits = appearanceCredits(
    registry,
    resolve({ ...PLATFORM_DEFAULTS, variant: 'acme-gallery' }),
  );
  assert.deepEqual(credits, {
    scheme: { id: WARM_PARCHMENT.id, name: WARM_PARCHMENT.name },
    language: { id: PLATFORM_NEUTRAL.id, name: PLATFORM_NEUTRAL.name },
    typography: { id: HUMANIST_UI.id, name: HUMANIST_UI.name },
  });
});

test('an axis that falls back credits its fallback, not what the site asked for', () => {
  const resolved = resolve({
    ...PLATFORM_DEFAULTS,
    variant: 'acme-gallery',
    colorScheme: 'no-such-scheme',
    designLanguage: 'no-such-language',
  });
  assert.deepEqual(resolved.fallbackAxes.slice().sort(), ['colorScheme', 'designLanguage']);
  const credits = appearanceCredits(registry, resolved);
  assert.equal(credits.scheme.id, resolved.selection.colorScheme);
  assert.notEqual(credits.scheme.id, 'no-such-scheme');
  assert.equal(credits.language.id, resolved.selection.designLanguage);
  assert.notEqual(credits.language.name, 'no-such-language');
});
