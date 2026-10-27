import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavigationMenuSlot, registerHostModules, type NavigationMenuProps } from '.';
import type { HostNavigationMenuProps } from './host-modules';

// The Menu slot (stream A, global rule 7): the host's Menu where the host
// registers one, and otherwise a plain link to the composition's index, so
// a composition stays a server module and every place stays a real link.

Object.assign(globalThis, { React });

const slot = (props: Partial<NavigationMenuProps> = {}) =>
  renderToStaticMarkup(
    <NavigationMenuSlot id="menu" label="Menu" href="#site-index" {...props}>
      <ul>
        <li>
          <a href="#work">Work</a>
        </li>
      </ul>
    </NavigationMenuSlot>,
  );

test('with no Menu registered, the slot is a plain link to the index, in the label language', () => {
  registerHostModules({});
  assert.equal(slot(), '<a href="#site-index" data-navigation-menu-link="">Menu</a>');
  assert.equal(
    slot({ lang: 'en', href: '#pv-site-index' }),
    '<a href="#pv-site-index" lang="en" data-navigation-menu-link="">Menu</a>',
  );
});

test("with the host's Menu registered, the slot renders it with the id, the label, the link, and the composition's own links", () => {
  const given: NavigationMenuProps[] = [];
  registerHostModules({
    navigationMenu: (props) => {
      given.push(props);
      return (
        <div data-menu={props.id} data-href={props.href} lang={props.lang}>
          <button type="button">{props.label}</button>
          {props.children}
        </div>
      );
    },
  });
  try {
    assert.equal(
      slot({ lang: 'en' }),
      '<div data-menu="menu" data-href="#site-index" lang="en"><button type="button">Menu</button><ul><li><a href="#work">Work</a></li></ul></div>',
    );
    assert.deepEqual(
      given.map(({ id, label, lang, href }) => ({ id, label, lang, href })),
      [{ id: 'menu', label: 'Menu', lang: 'en', href: '#site-index' }],
    );
  } finally {
    registerHostModules({});
  }
  // A later registration without one puts the plain link back.
  assert.match(slot(), /^<a href="#site-index" data-navigation-menu-link="">/);
});

test("the slot hands the host's Menu the visitor control, in its Menu form, only when the composition asks", () => {
  const given: HostNavigationMenuProps[] = [];
  registerHostModules({
    visitorControl: ({ inMenu }) => <form data-in-menu={String(Boolean(inMenu))} />,
    navigationMenu: (props) => {
      given.push(props);
      return <div>{props.control}</div>;
    },
  });
  try {
    assert.equal(
      slot({ visitorControl: { media: '(width < 48rem)' } }),
      '<div><form data-in-menu="true"></form></div>',
    );
    assert.deepEqual(given[0]?.visitorControl, { media: '(width < 48rem)' });
    given.length = 0;
    assert.equal(slot(), '<div></div>');
    assert.equal(given[0]?.control, undefined);
  } finally {
    registerHostModules({});
  }
});
