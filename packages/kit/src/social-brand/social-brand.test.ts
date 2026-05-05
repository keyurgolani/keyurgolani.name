import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSocialBrandStyle,
  inferPlatformFromUrl,
  listSocialBrands,
} from './index';

test('returns the brand style for a known platform', () => {
  const github = getSocialBrandStyle('github');
  assert.equal(github.name, 'GitHub');
  assert.match(github.gradient, /linear-gradient/);
});

test('lookup is case-insensitive', () => {
  assert.equal(getSocialBrandStyle('GitHub').name, 'GitHub');
  assert.equal(getSocialBrandStyle('GITHUB').name, 'GitHub');
});

test('falls back to default for unknown platforms', () => {
  const fallback = getSocialBrandStyle('myspace');
  assert.equal(fallback.name, 'Link');
});

test('falls back to default for null/undefined', () => {
  assert.equal(getSocialBrandStyle(undefined).name, 'Link');
  assert.equal(getSocialBrandStyle(null).name, 'Link');
  assert.equal(getSocialBrandStyle('').name, 'Link');
});

test('aliases map to canonical keys', () => {
  assert.equal(getSocialBrandStyle('docker').name, 'Docker Hub');
  assert.equal(getSocialBrandStyle('gh').name, 'GitHub');
  assert.equal(getSocialBrandStyle('li').name, 'LinkedIn');
  assert.equal(getSocialBrandStyle('ig').name, 'Instagram');
  assert.equal(getSocialBrandStyle('tw').name, 'Twitter');
});

test('listSocialBrands omits the default fallback', () => {
  const brands = listSocialBrands();
  assert.equal(brands.includes('default'), false);
  assert.equal(brands.includes('github'), true);
  assert.equal(brands.includes('linkedin'), true);
});

test('inferPlatformFromUrl identifies GitHub', () => {
  assert.equal(inferPlatformFromUrl('https://github.com/user'), 'github');
  assert.equal(inferPlatformFromUrl('https://www.github.com/user'), 'github');
});

test('inferPlatformFromUrl identifies LinkedIn', () => {
  assert.equal(inferPlatformFromUrl('https://linkedin.com/in/user'), 'linkedin');
  assert.equal(inferPlatformFromUrl('https://www.linkedin.com/in/user'), 'linkedin');
});

test('inferPlatformFromUrl identifies Docker Hub', () => {
  assert.equal(inferPlatformFromUrl('https://hub.docker.com/u/user'), 'dockerhub');
});

test('inferPlatformFromUrl identifies ResearchGate', () => {
  assert.equal(
    inferPlatformFromUrl('https://www.researchgate.net/profile/user'),
    'researchgate',
  );
});

test('inferPlatformFromUrl identifies Instagram', () => {
  assert.equal(inferPlatformFromUrl('https://instagram.com/user'), 'instagram');
});

test('inferPlatformFromUrl distinguishes x from twitter', () => {
  assert.equal(inferPlatformFromUrl('https://x.com/user'), 'x');
  assert.equal(inferPlatformFromUrl('https://twitter.com/user'), 'twitter');
});

test('inferPlatformFromUrl identifies Bluesky', () => {
  assert.equal(inferPlatformFromUrl('https://bsky.app/profile/user'), 'bluesky');
});

test('inferPlatformFromUrl identifies Mastodon', () => {
  assert.equal(inferPlatformFromUrl('https://hachyderm.io/@user'), null);
  assert.equal(inferPlatformFromUrl('https://mastodon.social/@user'), 'mastodon');
});

test('inferPlatformFromUrl identifies email', () => {
  assert.equal(inferPlatformFromUrl('mailto:user@example.com'), 'email');
});

test('inferPlatformFromUrl returns null for unknown hosts', () => {
  assert.equal(inferPlatformFromUrl('https://example.com'), null);
});

test('inferPlatformFromUrl handles invalid URLs gracefully', () => {
  assert.equal(inferPlatformFromUrl('not-a-url'), null);
  assert.equal(inferPlatformFromUrl(''), null);
});
