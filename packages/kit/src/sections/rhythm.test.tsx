import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rhythmFrame, sectionRhythms } from './rhythm';
import type { FrameAttributes, SectionFrameProps } from './types';

// The section rhythm (redesign dossier G4): the gap before each section,
// by its kind and the one before it, so a page has a ladder of gaps.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const section = (id: string, kind: string) => ({ id, kind }) as never;

test("the bundled sample's order takes chapters before each region, groups for what belongs together, and three gaps or more", () => {
  const sections = [
    ['top', 'hero'],
    ['thesis', 'practice'],
    ['work-showcase', 'works'],
    ['at-a-glance', 'evidence'],
    ['about', 'lede'],
    ['now', 'now'],
    ['currently-focused-on', 'focus'],
    ['essays', 'works'],
    ['words-from-collaborators', 'evidence'],
    ['skills', 'practice'],
    ['experience', 'chronology'],
    ['education', 'chronology'],
    ['publications', 'evidence'],
    ['talks', 'evidence'],
    ['awards', 'evidence'],
    ['incident-history', 'works'],
    ['patents', 'evidence'],
    ['looking', 'works'],
    ['listening-a-small-experiment', 'works'],
    ['press', 'evidence'],
    ['off-the-page', 'fun-facts'],
    ['quote', 'quote'],
    ['stack-i-currently-reach-for', 'practice'],
    ['engagements', 'practice'],
    ['elsewhere', 'evidence'],
    ['on-github', 'github'],
    ['contact', 'contact'],
    ['want-to-work-together', 'cta'],
  ].map(([id, kind]) => section(id!, kind!));
  const rhythms = sectionRhythms(sections);
  assert.equal(rhythms.has('top'), false);
  const by = (rhythm: string) =>
    [...rhythms].filter(([, value]) => value === rhythm).map(([id]) => id);
  assert.deepEqual(by('chapter'), [
    'work-showcase',
    'at-a-glance',
    'about',
    'now',
    'experience',
    'contact',
  ]);
  // What follows the hero continues the opening.
  assert.deepEqual(by('group'), [
    'thesis',
    'currently-focused-on',
    'education',
    'talks',
    'awards',
    'listening-a-small-experiment',
    'quote',
    'engagements',
    'on-github',
    'want-to-work-together',
  ]);
  assert.equal(by('section').length, sections.length - 1 - 6 - 10);
  assert.equal(new Set(rhythms.values()).size, 3);
});

test('a lede right after the hero continues the opening, and an extension section never opens a chapter', () => {
  const rhythms = sectionRhythms([
    section('top', 'hero'),
    section('about', 'lede'),
    section('shows', '@acme/portfolio-photography/exhibitions'),
    section('more', '@acme/portfolio-photography/prints'),
    section('end', 'contact'),
  ]);
  assert.deepEqual(
    [...rhythms],
    [
      ['about', 'group'],
      ['shows', 'section'],
      ['more', 'group'],
      ['end', 'chapter'],
    ],
  );
  assert.equal(sectionRhythms([]).size, 0);
});

test("rhythmFrame() puts the rhythm on the frame's root, and leaves the first section's frame as it was", () => {
  const Frame = rhythmFrame(sectionRhythms([section('a', 'hero'), section('b', 'works')]));
  const frame = (id: string): FrameAttributes => ({
    id,
    'data-section-id': id,
    'data-kind': 'works',
    'data-renderer': 'shared',
  });
  const render = (id: string) =>
    renderToStaticMarkup(
      <Frame frame={frame(id)} section={section(id, 'works')} level={2}>
        <p>Body</p>
      </Frame>,
    );
  assert.equal(
    render('a'),
    '<section id="a" data-section-id="a" data-kind="works" data-renderer="shared"><p>Body</p></section>',
  );
  assert.equal(
    render('b'),
    '<section id="b" data-section-id="b" data-kind="works" data-renderer="shared" data-rhythm="group"><p>Body</p></section>',
  );
  // A composition's own frame gets the attribute to spread too.
  const Own = ({ frame, children }: SectionFrameProps) => <article {...frame}>{children}</article>;
  const Wrapped = rhythmFrame(new Map([['b', 'group']]), Own);
  assert.match(
    renderToStaticMarkup(
      <Wrapped frame={frame('b')} section={section('b', 'works')} level={2}>
        x
      </Wrapped>,
    ),
    /^<article [^>]*data-rhythm="group">x<\/article>$/,
  );
});
