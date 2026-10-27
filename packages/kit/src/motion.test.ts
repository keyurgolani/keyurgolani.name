import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MotionPolicy } from '@portfolio/schema';
import { MotionPolicyProvider, shouldReduceMotion, useMotionPreference } from './motion';

/**
 * What useMotionPreference(own) resolves to while the server renders, as
 * text, under a MotionPolicyProvider giving `provided`, or none for null.
 */
function resolvedOnServer(provided: MotionPolicy | null, own?: MotionPolicy): string {
  function Probe() {
    return createElement('i', null, useMotionPreference(own));
  }
  const probe = createElement(Probe);
  return renderToStaticMarkup(
    provided === null ? probe : createElement(MotionPolicyProvider, { policy: provided }, probe),
  );
}

test('a reduce policy from the provider reaches every hook below it', () => {
  assert.equal(resolvedOnServer('reduce'), '<i>reduce</i>');
  // The server can't know the OS's preference, so respect-os renders the
  // still there, and follows the OS once hydrated (#6).
  assert.equal(resolvedOnServer('respect-os'), '<i>reduce</i>');
  // Without a provider, it's respect-os.
  assert.equal(resolvedOnServer(null), '<i>reduce</i>');
  // A policy given to the hook can add a reduce, and can't take one away.
  assert.equal(resolvedOnServer('respect-os', 'reduce'), '<i>reduce</i>');
  assert.equal(resolvedOnServer('reduce', 'respect-os'), '<i>reduce</i>');
  assert.equal(resolvedOnServer(null, 'reduce'), '<i>reduce</i>');
});

test('reduce always reduces motion', () => {
  assert.equal(shouldReduceMotion('reduce', false), true);
  assert.equal(shouldReduceMotion('reduce', true), true);
});

test('respect-os follows the OS, and no policy animates past an OS reduce preference', () => {
  assert.equal(shouldReduceMotion('respect-os', false), false);
  assert.equal(shouldReduceMotion('respect-os', true), true);
});
