import test from 'node:test';
import assert from 'node:assert/strict';
import { languageDirection } from './direction';

// Which way a language tag's text runs: the script subtag right after the
// language decides when there is one, and otherwise the language does.

test('the language decides when the tag names no script', () => {
  for (const tag of ['ar', 'he-IL', 'fa', 'ur-PK', 'yi']) {
    assert.equal(languageDirection(tag), 'rtl', tag);
  }
  for (const tag of ['en', 'pt-BR', 'zh-TW', 'de-1901']) {
    assert.equal(languageDirection(tag), 'ltr', tag);
  }
});

test('the script right after the language decides when there is one', () => {
  assert.equal(languageDirection('sd-Deva'), 'ltr');
  assert.equal(languageDirection('ar-Latn'), 'ltr');
  assert.equal(languageDirection('az-Arab'), 'rtl');
  assert.equal(languageDirection('en-Arab-u-nu-latn'), 'rtl');
  assert.equal(languageDirection('sr-Latn-RS'), 'ltr');
});

test('a four-letter subtag in an extension or private use is not the script', () => {
  // Each singleton (-u-, -x-, -t-) starts subtags that say nothing about the script.
  assert.equal(languageDirection('ar-u-nu-latn'), 'rtl');
  assert.equal(languageDirection('he-x-test'), 'rtl');
  assert.equal(languageDirection('ar-t-en-latn'), 'rtl');
  assert.equal(languageDirection('ar-EG-x-latn'), 'rtl');
  assert.equal(languageDirection('en-u-nu-arab'), 'ltr');
  assert.equal(languageDirection('en-x-hebr'), 'ltr');
});
