import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checklist, FLASH_ITEM } from './checklist';
import { loadRegistrations } from './lib/registration';

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

test("a surface's checklist covers its routes in each state, its interactions, its primary actions, and the flash check", async () => {
  const text = checklist('login', await loadRegistrations(), WEB);
  assert.match(text, /^# Manual checklist: login \(surface\)$/m);
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
  assert.ok(text.includes(`- [ ] ${FLASH_ITEM}`));
  assert.match(FLASH_ITEM, /WCAG 2\.3\.1/);
});

test("a composition's checklist covers its routes and every state fixture", async () => {
  const text = checklist('fallback', await loadRegistrations(), WEB);
  assert.match(text, /^# Manual checklist: fallback \(composition\)$/m);
  assert.ok(text.includes('- [ ] / (complete):'));
  assert.ok(text.includes('- [ ] /work/project-name (missing-media):'));
  assert.ok(text.includes('None registered: confirm the page has no dialog'));
  assert.ok(text.includes(FLASH_ITEM));
});

test('an id nothing registers fails, naming what is registered', async () => {
  const registrations = await loadRegistrations();
  assert.throws(
    () => checklist('studio', registrations, WEB),
    /Nothing registers studio\. Registered: login, fallback\./,
  );
});
