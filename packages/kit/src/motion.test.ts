import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReduceMotion } from './motion';

test('reduce always reduces motion', () => {
  assert.equal(shouldReduceMotion('reduce', false), true);
  assert.equal(shouldReduceMotion('reduce', true), true);
});

test('respect-os follows the OS, and no policy animates past an OS reduce preference', () => {
  assert.equal(shouldReduceMotion('respect-os', false), false);
  assert.equal(shouldReduceMotion('respect-os', true), true);
});
