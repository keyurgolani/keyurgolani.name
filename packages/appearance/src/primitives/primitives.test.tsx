import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { elements, html, one, slotted, slotValues, text } from '../test-support/markup';
import {
  Action,
  Aside,
  Badge,
  Checkbox,
  DataDisplay,
  Dialog,
  Disclosure,
  Field,
  Footer,
  Header,
  Main,
  Media,
  Navigation,
  PRIMITIVES,
  Radio,
  Region,
  Select,
  SkipLink,
  SLOT_VALUES,
  SLOTS,
  Surface,
  Tabs,
  Toast,
  ToastRegion,
  Tooltip,
  type SlotName,
} from '.';
import { TabList } from './tabs';

// @portfolio/appearance/primitives (#19, Slice 3, item 2), rendered with
// react-dom/server: each primitive's markup, its root and parts on
// data-ui-slot, its state on ARIA, native, and data attributes, never a
// class, and its ids from the id it's given.

const TAB_ITEMS = [
  { id: 'summary', label: 'Summary', content: 'Three sources agree.' },
  { id: 'sources', label: 'Sources', content: 'Field records.' },
];

/** One of every primitive, in the states the tests read, so every slot and part renders. */
const SPECIMENS: Readonly<Record<SlotName, () => ReactNode>> = {
  action: () => (
    <>
      <Action emphasis="primary">Publish revision</Action>
      <Action icon={<svg />}>Save draft</Action>
      <Action loading>Validating</Action>
    </>
  ),
  surface: () => <Surface>Default surface</Surface>,
  navigation: () => (
    <Navigation
      label="Specimen"
      items={[
        { href: '#overview', label: 'Overview', current: 'page' },
        { href: '#controls', label: 'Controls' },
      ]}
    />
  ),
  field: () => (
    <Field
      id="note"
      label="Revision note"
      description="Name the outcome."
      error="Add the outcome."
    />
  ),
  select: () => (
    <Select
      id="depth"
      label="Depth"
      description="How much to review."
      error="Pick one."
      groups={[{ label: 'Stable', choices: [{ value: 'full', label: 'Full' }] }]}
    />
  ),
  checkbox: () => (
    <Checkbox id="states" label="Include states" description="Hover, focus, and loading." />
  ),
  radio: () => (
    <Radio
      id="density"
      legend="Density"
      name="density"
      description="How tight the controls sit."
      options={[
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact', unavailable: 'Not in this language' },
      ]}
    />
  ),
  badge: () => (
    <Badge status="positive" icon={<svg />}>
      Verified
    </Badge>
  ),
  // The sections the server renders, then the tablist hydration turns them into.
  tabs: () => (
    <>
      <Tabs id="views" label="Evidence views" items={TAB_ITEMS} />
      <TabList id="views-live" label="Evidence views" items={TAB_ITEMS} />
    </>
  ),
  disclosure: () => <Disclosure summary="Why this changed">Three sources converged.</Disclosure>,
  dialog: () => (
    <Dialog id="decision" trigger="Open decision note" title="Decision note" description="Why.">
      <p>Body</p>
    </Dialog>
  ),
  tooltip: () => (
    <Tooltip id="confidence" content="Recency, agreement, and coverage.">
      Explain confidence
    </Tooltip>
  ),
  toast: () => (
    <>
      <Toast actions={<Action>Undo</Action>}>Draft saved locally.</Toast>
      <ToastRegion id="toasts" />
    </>
  ),
  media: () => (
    <>
      <Media alt="A field map" src="/map.png" caption="Field map" />
      <Media alt="A missing field map" />
    </>
  ),
  'data-display': () => (
    <DataDisplay
      caption="Signals"
      columns={[
        { key: 'name', label: 'Signal' },
        { key: 'value', label: 'Value', numeric: true },
      ]}
      rows={[{ key: 'a', cells: { name: 'Agreement', value: '68' } }]}
      bars={{ column: 'value', max: 100, encoding: 'categorical', values: { a: 68 } }}
    />
  ),
  'skip-link': () => <SkipLink target="main" />,
  // The visitor control's slots render in visitor-appearance.test.tsx.
  'appearance-control': () => null,
};

test('every primitive and part in SLOTS renders, and nothing renders a slot SLOTS lacks', () => {
  assert.equal(PRIMITIVES.length, 15);
  const known = new Set<string>(SLOT_VALUES);
  for (const slot of Object.keys(SLOTS) as SlotName[]) {
    if (slot === 'appearance-control') continue;
    const rendered = slotValues(html(SPECIMENS[slot]()));
    for (const value of rendered)
      assert.ok(known.has(value), `${slot} renders ${value}, which SLOTS lacks`);
    const expected = [slot, ...SLOTS[slot].map((part) => `${slot}.${part}`)];
    for (const value of expected) {
      assert.ok(
        rendered.includes(value),
        `${slot}'s specimen renders no [data-ui-slot="${value}"]`,
      );
    }
  }
});

test('no primitive shows state or kind through a class or an inline style', () => {
  for (const specimen of Object.values(SPECIMENS)) {
    for (const element of elements(html(specimen()))) {
      assert.equal(element.attributes.class, undefined, `${element.tag} has a class`);
      assert.equal(element.attributes.style, undefined, `${element.tag} has an inline style`);
    }
  }
});

test('Action is a button of type button, its emphasis on data-emphasis, its label a part', () => {
  const markup = html(<Action>Save draft</Action>);
  const action = one(markup, 'action');
  assert.equal(action.tag, 'button');
  assert.equal(action.attributes.type, 'button');
  assert.equal(action.attributes['data-emphasis'], 'secondary');
  assert.equal(text(markup), 'Save draft');
  assert.equal(
    one(html(<Action emphasis="primary">Go</Action>), 'action').attributes['data-emphasis'],
    'primary',
  );
  assert.equal(one(html(<Action type="submit">Go</Action>), 'action').attributes.type, 'submit');
});

test('Action with an href is a link, and an unavailable one goes nowhere but keeps its name', () => {
  const link = one(html(<Action href="/work">See the work</Action>), 'action');
  assert.equal(link.tag, 'a');
  assert.equal(link.attributes.href, '/work');
  const unavailable = one(
    html(
      <Action href="/work" disabled>
        See the work
      </Action>,
    ),
    'action',
  );
  assert.equal(unavailable.tag, 'a');
  assert.equal(unavailable.attributes.href, undefined);
  assert.equal(unavailable.attributes.role, 'link');
  assert.equal(unavailable.attributes['aria-disabled'], 'true');
  assert.equal(
    unavailable.attributes.tabindex,
    undefined,
    'out of the tab order, as a disabled button is',
  );
});

test('a loading link goes nowhere but keeps its place in the tab order, as a loading button does', () => {
  const loading = one(
    html(
      <Action href="/work" loading>
        Fetching the work
      </Action>,
    ),
    'action',
  );
  assert.equal(loading.tag, 'a');
  assert.equal(loading.attributes.href, undefined);
  assert.equal(loading.attributes.role, 'link');
  assert.equal(loading.attributes['aria-disabled'], 'true');
  assert.equal(loading.attributes['aria-busy'], 'true');
  assert.equal(loading.attributes.tabindex, '0');
});

test('a loading submit button renders as any submit button does, its click stopped once it hydrates', () => {
  // The click handler is the client half's (action-client.tsx), which the
  // server renders the same markup for; tests/appearance clicks it.
  const markup = html(
    <form action="/next">
      <Action type="submit" loading>
        Saving
      </Action>
    </form>,
  );
  const submit = one(markup, 'action');
  assert.equal(submit.attributes.type, 'submit');
  assert.equal(submit.attributes['aria-disabled'], 'true');
  assert.equal(submit.attributes.disabled, undefined);
});

test("Action's states: disabled is native, loading keeps focus with aria-busy and aria-disabled, pressed is aria-pressed", () => {
  const disabled = one(html(<Action disabled>Unavailable</Action>), 'action');
  assert.equal(disabled.attributes.disabled, '');
  assert.equal(disabled.attributes['aria-disabled'], undefined);

  const loadingMarkup = html(<Action loading>Validating</Action>);
  const loading = one(loadingMarkup, 'action');
  assert.equal(loading.attributes.disabled, undefined, 'a loading action stays focusable');
  assert.equal(loading.attributes['aria-busy'], 'true');
  assert.equal(loading.attributes['aria-disabled'], 'true');
  assert.equal(loading.attributes['data-state'], 'loading');
  assert.equal(one(loadingMarkup, 'action.spinner').attributes['aria-hidden'], 'true');

  assert.equal(
    one(html(<Action pressed>Selected</Action>), 'action').attributes['aria-pressed'],
    'true',
  );
  assert.equal(
    one(html(<Action pressed={false}>Off</Action>), 'action').attributes['aria-pressed'],
    'false',
  );
});

test("Action's icon is hidden from assistive technology, and an icon-only action takes its name from label", () => {
  const markup = html(
    <Action icon={<svg />} label="Close note">
      {''}
    </Action>,
  );
  assert.equal(one(markup, 'action.icon').attributes['aria-hidden'], 'true');
  assert.equal(one(markup, 'action').attributes['aria-label'], 'Close note');
});

test('Action carries an invoker command, spelled as HTML spells it', () => {
  const action = one(
    html(<Action command={{ for: 'note', action: 'show-modal' }}>Open</Action>),
    'action',
  );
  assert.equal(action.attributes.commandfor, 'note');
  assert.equal(action.attributes.command, 'show-modal');
});

test("Surface's level is data-emphasis; it's a div unless it's an article", () => {
  const surface = one(html(<Surface labelledBy="h">Body</Surface>), 'surface');
  assert.equal(surface.tag, 'div');
  assert.equal(surface.attributes['data-emphasis'], 'default');
  assert.equal(surface.attributes['aria-labelledby'], 'h');
  const card = one(
    html(
      <Surface as="article" emphasis="prominent">
        Body
      </Surface>,
    ),
    'surface',
  );
  assert.equal(card.tag, 'article');
  assert.equal(card.attributes['data-emphasis'], 'prominent');
});

test("Badge's status is data-status, and its words are its label", () => {
  const markup = html(<Badge status="danger">Blocked</Badge>);
  assert.equal(one(markup, 'badge').attributes['data-status'], 'danger');
  assert.equal(text(markup), 'Blocked');
  assert.equal(one(html(<Badge>Revision 18</Badge>), 'badge').attributes['data-status'], 'neutral');
});

test('Disclosure is a native details element, open when asked', () => {
  const markup = html(
    <Disclosure summary="Why" open>
      Because
    </Disclosure>,
  );
  const root = one(markup, 'disclosure');
  assert.equal(root.tag, 'details');
  assert.equal(root.attributes.open, '');
  assert.equal(one(markup, 'disclosure.summary').tag, 'summary');
  assert.equal(
    one(html(<Disclosure summary="Why">Because</Disclosure>), 'disclosure').attributes.open,
    undefined,
  );
});

test('Field labels its control, describes it with its help and error, and marks it invalid', () => {
  const markup = html(
    <Field
      id="pl-note"
      label="Revision note"
      name="note"
      required
      description="Name the outcome."
      error="Add the outcome first."
    />,
  );
  const label = one(markup, 'field.label');
  const control = one(markup, 'field.control');
  assert.equal(label.tag, 'label');
  assert.equal(label.attributes.for, 'pl-note');
  assert.equal(control.tag, 'input');
  assert.equal(control.attributes.id, 'pl-note');
  assert.equal(control.attributes.type, 'text');
  assert.equal(control.attributes.required, '');
  assert.equal(control.attributes['aria-invalid'], 'true');
  assert.equal(control.attributes['aria-describedby'], 'pl-note--description pl-note--error');
  assert.equal(one(markup, 'field.description').attributes.id, 'pl-note--description');
  const error = one(markup, 'field.error');
  assert.equal(error.attributes.id, 'pl-note--error');
  assert.equal(error.attributes['data-status'], 'danger');

  const valid = one(html(<Field id="email" label="Email" type="email" />), 'field.control');
  assert.equal(valid.attributes['aria-invalid'], undefined);
  assert.equal(valid.attributes['aria-describedby'], undefined);
  assert.equal(
    one(html(<Field id="body" label="Body" multiline />), 'field.control').tag,
    'textarea',
  );
});

test('Checkbox sits inside its label, so the whole row is its target, and names its description', () => {
  const markup = html(
    <Checkbox id="states" label="Include states" description="Hover and focus." defaultChecked />,
  );
  const label = one(markup, 'checkbox.label');
  const control = one(markup, 'checkbox.control');
  assert.equal(label.tag, 'label');
  assert.ok(control.index > label.index, 'the input is inside the label');
  assert.equal(control.attributes.type, 'checkbox');
  assert.equal(control.attributes.checked, '');
  assert.equal(control.attributes['aria-describedby'], 'states--description');
});

test('Radio is a fieldset with a legend; an unavailable option is disabled and names its reason', () => {
  const markup = html(
    <Radio
      id="mode"
      legend="Display mode"
      name="mode"
      defaultValue="dark"
      options={[
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light', unavailable: 'Night Fixture has no light mode' },
        { value: 'dark', label: 'Dark' },
      ]}
    />,
  );
  assert.equal(one(markup, 'radio').tag, 'fieldset');
  assert.equal(one(markup, 'radio.legend').tag, 'legend');
  const controls = slotted(markup, 'radio.control');
  assert.deepEqual(
    controls.map((control) => control.attributes.value),
    ['system', 'light', 'dark'],
  );
  assert.ok(controls.every((control) => control.attributes.name === 'mode'));
  assert.equal(controls[1]!.attributes.disabled, '');
  assert.equal(controls[1]!.attributes['aria-describedby'], 'mode--reason-2');
  assert.equal(one(markup, 'radio.reason').attributes.id, 'mode--reason-2');
  assert.match(text(markup), /Night Fixture has no light mode/);
  assert.equal(controls[2]!.attributes.checked, '');
  assert.equal(controls[0]!.attributes.checked, undefined);
});

test("Select labels a native select, groups its options, and says why an unavailable one can't be chosen", () => {
  const markup = html(
    <Select
      id="scheme"
      label="Color scheme"
      name="scheme"
      defaultValue="warm-parchment"
      groups={[
        { label: 'Stable', choices: [{ value: 'warm-parchment', label: 'Warm Parchment' }] },
        {
          label: 'Experimental',
          choices: [
            {
              value: 'fixture-dark-only',
              label: 'Fixture Dark Only',
              unavailable: 'no light mode',
            },
          ],
        },
      ]}
    />,
  );
  assert.equal(one(markup, 'select.label').attributes.for, 'scheme');
  const control = one(markup, 'select.control');
  assert.equal(control.tag, 'select');
  assert.equal(control.attributes.name, 'scheme');
  assert.deepEqual(
    elements(markup)
      .filter((element) => element.tag === 'optgroup')
      .map((group) => group.attributes.label),
    ['Stable', 'Experimental'],
  );
  const options = elements(markup).filter((element) => element.tag === 'option');
  assert.equal(options[0]!.attributes.selected, '');
  assert.equal(options[1]!.attributes.disabled, '');
  assert.match(text(markup), /Fixture Dark Only \(no light mode\)/);
  // A group without a label puts its options straight in the select.
  const flat = html(
    <Select id="variant" label="Variant" groups={[{ choices: [{ value: 'a', label: 'A' }] }]} />,
  );
  assert.equal(elements(flat).filter((element) => element.tag === 'optgroup').length, 0);
});

test('Tabs renders headed sections on the server, which need no JavaScript', () => {
  const markup = html(
    <Tabs
      id="views"
      label="Evidence views"
      headingLevel={4}
      items={[
        { id: 'summary', label: 'Summary', content: 'Agree.' },
        { id: 'sources', label: 'Sources', content: 'Records.' },
      ]}
    />,
  );
  assert.equal(slotted(markup, 'tabs.list').length, 0, 'no tablist without JavaScript');
  assert.ok(!elements(markup).some((element) => element.attributes.role === 'tab'));
  const panels = slotted(markup, 'tabs.panel');
  assert.deepEqual(
    panels.map((panel) => [panel.tag, panel.attributes.id, panel.attributes['aria-labelledby']]),
    [
      ['section', 'views--panel-summary', 'views--heading-summary'],
      ['section', 'views--panel-sources', 'views--heading-sources'],
    ],
  );
  const headings = slotted(markup, 'tabs.heading');
  assert.deepEqual(
    headings.map((heading) => heading.tag),
    ['h4', 'h4'],
  );
  assert.equal(text(markup), 'Summary Agree. Sources Records.');
});

test("Tabs' interactive form is a named tablist: one tab in the tab order, each naming its panel, the others hidden", () => {
  const markup = html(
    <TabList
      id="views"
      label="Evidence views"
      defaultSelected="sources"
      items={[
        { id: 'summary', label: 'Summary', content: 'Agree.' },
        { id: 'sources', label: 'Sources', content: 'Records.' },
      ]}
    />,
  );
  const list = one(markup, 'tabs.list');
  assert.equal(list.attributes.role, 'tablist');
  assert.equal(list.attributes['aria-label'], 'Evidence views');
  assert.equal(list.attributes['aria-orientation'], 'horizontal');
  const tabs = slotted(markup, 'tabs.tab');
  assert.deepEqual(
    tabs.map((tab) => [
      tab.attributes.role,
      tab.attributes.id,
      tab.attributes['aria-selected'],
      tab.attributes['aria-controls'],
      tab.attributes.tabindex,
    ]),
    [
      ['tab', 'views--tab-summary', 'false', 'views--panel-summary', '-1'],
      ['tab', 'views--tab-sources', 'true', 'views--panel-sources', '0'],
    ],
  );
  const panels = slotted(markup, 'tabs.panel');
  assert.deepEqual(
    panels.map((panel) => [
      panel.attributes.role,
      panel.attributes['aria-labelledby'],
      panel.attributes.hidden,
    ]),
    [
      ['tabpanel', 'views--tab-summary', ''],
      ['tabpanel', 'views--tab-sources', undefined],
    ],
  );
});

test('Dialog is an action with aria-haspopup and an invoker command, and a native dialog named by its title', () => {
  const markup = html(
    <Dialog
      id="decision"
      trigger="Open decision note"
      title="Decision note"
      description="Why it changed."
    >
      <p>Body</p>
    </Dialog>,
  );
  const [trigger, close] = slotted(markup, 'action');
  assert.equal(trigger!.attributes['aria-haspopup'], 'dialog');
  assert.equal(trigger!.attributes['aria-controls'], 'decision');
  assert.equal(trigger!.attributes.commandfor, 'decision');
  assert.equal(trigger!.attributes.command, 'show-modal');
  const dialog = one(markup, 'dialog');
  assert.equal(dialog.tag, 'dialog');
  assert.equal(dialog.attributes.id, 'decision');
  assert.equal(dialog.attributes.open, undefined, 'it starts closed');
  assert.equal(dialog.attributes['aria-labelledby'], 'decision--title');
  assert.equal(dialog.attributes['aria-describedby'], 'decision--description');
  assert.equal(one(markup, 'dialog.title').tag, 'h2');
  assert.equal(close!.attributes.commandfor, 'decision');
  assert.equal(close!.attributes.command, 'close');
  assert.match(text(markup), /Close$/);
});

test('Tooltip is a hint popover the action names in aria-describedby', () => {
  const markup = html(
    <Tooltip id="confidence" content="Recency, agreement, and coverage.">
      Explain confidence
    </Tooltip>,
  );
  const tip = one(markup, 'tooltip');
  assert.equal(tip.attributes.id, 'confidence');
  assert.equal(tip.attributes.role, 'tooltip');
  assert.equal(tip.attributes.popover, 'hint');
  assert.equal(one(markup, 'action').attributes['aria-describedby'], 'confidence');
});

test('Toast is a polite status message; a ToastRegion is an empty status region from the first paint', () => {
  const toast = html(<Toast status="positive">Published.</Toast>);
  assert.equal(one(toast, 'toast').attributes.role, 'status');
  assert.equal(one(toast, 'toast').attributes['data-status'], 'positive');
  const region = html(
    <ToastRegion id="toasts">
      <p>Page</p>
    </ToastRegion>,
  );
  const element = one(region, 'toast.region');
  assert.equal(element.attributes.role, 'status');
  assert.equal(element.attributes.id, 'toasts');
  assert.equal(slotted(region, 'toast').length, 0);
  assert.match(region, /<p>Page<\/p>/);
});

test('Media needs alt text, loads lazily with its renditions, and stands in a named placeholder', () => {
  const markup = html(
    <Media
      alt="A field map"
      src="/map.png"
      renditions={[
        { src: '/map-640.png', width: 640 },
        { src: '/map-1280.png', width: 1280 },
      ]}
      sizes="(min-width: 60rem) 50vw, 100vw"
      width={1280}
      height={800}
      caption="Field map"
    />,
  );
  assert.equal(one(markup, 'media').tag, 'figure');
  const image = one(markup, 'media.image');
  assert.equal(image.attributes.alt, 'A field map');
  assert.equal(image.attributes.srcset, '/map-640.png 640w, /map-1280.png 1280w');
  assert.equal(image.attributes.sizes, '(min-width: 60rem) 50vw, 100vw');
  assert.equal(image.attributes.loading, 'lazy');
  assert.equal(image.attributes.width, '1280');
  assert.equal(one(markup, 'media.caption').tag, 'figcaption');
  assert.equal(
    one(html(<Media alt="" src="/x.png" eager />), 'media.image').attributes.loading,
    'eager',
  );

  const placeholder = one(html(<Media alt="A missing map" />), 'media.placeholder');
  assert.equal(placeholder.attributes.role, 'img');
  assert.equal(placeholder.attributes['aria-label'], 'A missing map');
  const decoration = one(html(<Media alt="" />), 'media.placeholder');
  assert.equal(decoration.attributes['aria-hidden'], 'true');
  assert.throws(() => html(<Media {...({} as { alt: string })} />), /alt text/);
});

test('DataDisplay is a captioned table with headed rows, numbers marked, and bars from their values', () => {
  const markup = html(
    <DataDisplay
      caption="Signals"
      columns={[
        { key: 'name', label: 'Signal' },
        { key: 'value', label: 'Value', numeric: true, sort: 'descending' },
      ]}
      rows={[
        { key: 'a', cells: { name: 'Agreement', value: '82' }, status: 'positive' },
        { key: 'b', cells: { name: 'Recency', value: '47' } },
      ]}
      bars={{ column: 'value', max: 100, encoding: 'sequential', values: { a: 82, b: 47 } }}
    />,
  );
  assert.equal(one(markup, 'data-display').tag, 'figure');
  // A keyboard reaches it, so it can scroll a table wider than its column (#11, 2.1.1).
  assert.equal(one(markup, 'data-display').attributes.tabindex, '0');
  assert.equal(one(markup, 'data-display.caption').tag, 'figcaption');
  const headers = slotted(markup, 'data-display.header');
  assert.deepEqual(
    headers.map((header) => [
      header.attributes.scope,
      header.attributes['data-state'],
      header.attributes['aria-sort'],
    ]),
    [
      ['col', undefined, undefined],
      ['col', 'numeric', 'descending'],
    ],
  );
  const rowHeads = elements(markup).filter(
    (element) => element.tag === 'th' && element.attributes.scope === 'row',
  );
  assert.equal(rowHeads.length, 2);
  const bars = slotted(markup, 'data-display.bar');
  assert.deepEqual(
    bars.map((bar) => [
      bar.attributes['data-value'],
      bar.attributes['data-series'],
      bar.attributes['aria-hidden'],
    ]),
    [
      ['82%', 'end', 'true'],
      ['47%', 'middle', 'true'],
    ],
  );
  assert.equal(slotted(markup, 'data-display.row')[1]!.attributes['data-status'], 'positive');
});

test('the landmark primitives render their native elements outside a plate', () => {
  const markup = html(
    <>
      <Header pinned>Banner</Header>
      <Navigation label="Primary" items={[{ href: '/', label: 'Home', current: 'page' }]} />
      <Main id="main">Content</Main>
      <Aside label="Notes">Notes</Aside>
      <Region label="Contact">Contact</Region>
      <Footer>End</Footer>
    </>,
  );
  const tags = elements(markup).map((element) => element.tag);
  for (const tag of ['header', 'nav', 'main', 'aside', 'section', 'footer'])
    assert.ok(tags.includes(tag), tag);
  const nav = one(markup, 'navigation');
  assert.equal(nav.attributes['aria-label'], 'Primary');
  assert.equal(nav.attributes['data-orientation'], 'horizontal');
  assert.equal(one(markup, 'navigation.link').attributes['aria-current'], 'page');
  assert.equal(elements(markup).find((element) => element.tag === 'main')!.attributes.id, 'main');
  assert.equal(
    elements(markup).find((element) => element.tag === 'header')!.attributes['data-pinned'],
    '',
  );
  assert.throws(() => html(<Region {...({} as { label: string })}>x</Region>), /needs a name/);
});

test('the skip link points at the main, out of sight until focused', () => {
  const link = one(html(<SkipLink target="main" lang="en" />), 'skip-link');
  assert.equal(link.tag, 'a');
  assert.equal(link.attributes.href, '#main');
  assert.equal(link.attributes.lang, 'en');
  assert.equal(text(html(<SkipLink target="main" />)), 'Skip to content');
});
