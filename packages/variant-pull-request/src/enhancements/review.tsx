'use client';

import { useEffect, useRef } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Pull Request's one enhancement (issue #270, contract): a small island on a
// page complete without it. It reads the server's markup, never the content:
// 1. the tabs: the panel links become a tab list (arrow keys, Home and End
//    move between them), one panel shows at a time, and any link or hash
//    into a panel shows that panel first;
// 2. the files: Viewed folds its file, fills the progress bar and counts;
//    the fold button folds a file; Expand opens the rest of a work, its case
//    study among it, which starts folded;
// 3. the view: Unified or Split, the split built from the unified rows,
//    offered only where a split fits (48rem and up);
// 4. the merge: Approve and merge stays a real link; once it's followed the
//    page shows the change as merged.
// Viewed state lasts the visit: nothing is stored. No loop, no timer, no
// scroll listener. Print shows every panel, fold and disclosure.

const NARROW = '(width < 48rem)';

/** The panel an element is in, or the panel it is. */
export function panelOf(target: Element | null): HTMLElement | null {
  return target?.closest<HTMLElement>('[data-pr-panel]') ?? null;
}

/** The index a key moves a tab list's selection to, from `at` of `count`, or none. */
export function nextTab(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (at + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** A diff row's pairs for a split view: removals beside the additions that follow them. */
export function pairRows<T>(
  rows: readonly { kind: 'del' | 'add' | 'other'; row: T }[],
): ({ del?: T; add?: T } | { other: T })[] {
  const out: ({ del?: T; add?: T } | { other: T })[] = [];
  let dels: T[] = [];
  let adds: T[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i += 1)
      out.push({
        ...(i < dels.length ? { del: dels[i]! } : {}),
        ...(i < adds.length ? { add: adds[i]! } : {}),
      });
    dels = [];
    adds = [];
  };
  for (const { kind, row } of rows) {
    if (kind === 'del') {
      if (adds.length > 0) flush();
      dels.push(row);
    } else if (kind === 'add') adds.push(row);
    else {
      flush();
      out.push({ other: row });
    }
  }
  flush();
  return out;
}

const off = (el: Element | null | undefined, on: boolean) => el?.toggleAttribute('data-pr-off', on);

/** The tabs (part 1). */
function tabs(root: HTMLElement): () => void {
  const nav = root.querySelector<HTMLElement>('[data-pr-tabs]');
  const list = nav?.querySelector('ul');
  const links = [...(nav?.querySelectorAll<HTMLAnchorElement>('a[data-pr-tab]') ?? [])];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-pr-panel]')];
  if (!nav || !list || links.length < 2) return () => {};
  const name = (link: HTMLAnchorElement) => link.dataset.prTab ?? '';
  const panelFor = (link: HTMLAnchorElement) =>
    panels.find((panel) => panel.dataset.prPanel === name(link));
  const labelled = new Map(panels.map((panel) => [panel, panel.getAttribute('aria-labelledby')]));
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', nav.getAttribute('aria-label') ?? '');
  for (const link of links) {
    link.parentElement?.setAttribute('role', 'presentation');
    link.setAttribute('role', 'tab');
    const panel = panelFor(link);
    if (panel) {
      link.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', link.id);
    }
  }
  root.setAttribute('data-pr-tabbed', '');
  const select = (which: string) => {
    for (const link of links) {
      const on = name(link) === which;
      link.setAttribute('aria-selected', String(on));
      link.tabIndex = on ? 0 : -1;
    }
    for (const panel of panels) off(panel, panel.dataset.prPanel !== which);
  };
  /** Shows the panel an in-page target is in, and opens what holds it. */
  const reveal = (hash: string): boolean => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    const target = id ? document.getElementById(id) : null;
    const panel = panelOf(target);
    if (!target || !panel || !root.contains(target)) return false;
    select(panel.dataset.prPanel ?? '');
    const file = target.closest('[data-pr-file]');
    off(file?.querySelector('.pr-file__body'), false);
    target.querySelector('details')?.setAttribute('open', '');
    return true;
  };
  // A hash into a panel shows it and lands there; any other page starts on the first panel.
  if (reveal(location.hash))
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView({ block: 'start' });
  else select(name(links[0]!));
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || !root.contains(link)) return;
    if (links.includes(link)) {
      event.preventDefault();
      select(name(link));
      history.replaceState(history.state, '', link.hash);
      const panel = panelFor(link);
      if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
      return;
    }
    // Any other link into a panel shows that panel first, then the browser follows it.
    reveal(link.hash);
  };
  const key = (event: KeyboardEvent) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-pr-tab]');
    if (!link) return;
    const to = nextTab(event.key, links.indexOf(link), links.length);
    if (to === undefined) return;
    event.preventDefault();
    const next = links[to]!;
    select(name(next));
    history.replaceState(history.state, '', next.hash);
    next.focus();
  };
  const hashed = () => reveal(location.hash);
  root.addEventListener('click', click);
  list.addEventListener('keydown', key);
  addEventListener('hashchange', hashed);
  return () => {
    root.removeEventListener('click', click);
    list.removeEventListener('keydown', key);
    removeEventListener('hashchange', hashed);
    root.removeAttribute('data-pr-tabbed');
    list.removeAttribute('role');
    list.removeAttribute('aria-label');
    for (const link of links) {
      link.parentElement?.removeAttribute('role');
      for (const attr of ['role', 'aria-controls', 'aria-selected', 'tabindex'])
        link.removeAttribute(attr);
    }
    for (const panel of panels) {
      off(panel, false);
      panel.removeAttribute('role');
      const was = labelled.get(panel);
      if (was) panel.setAttribute('aria-labelledby', was);
    }
  };
}

/** The files (part 2): Viewed, the fold, Expand. */
function files(root: HTMLElement): () => void {
  const all = [...root.querySelectorAll<HTMLElement>('[data-pr-file]')];
  if (all.length === 0) return () => {};
  const count = root.querySelector<HTMLElement>('[data-pr-viewed-count]');
  const bar = root.querySelector<HTMLElement>('[data-pr-progress]');
  const counted = count?.textContent ?? '';
  const ids = [...new Set(all.map((file) => file.dataset.prFile ?? ''))];
  const viewed = new Set<string>();
  const fold = (file: HTMLElement, shut: boolean) => {
    off(file.querySelector('.pr-file__body'), shut);
    file.querySelector('[data-pr-fold]')?.setAttribute('aria-expanded', String(!shut));
  };
  const tally = () => {
    if (count) count.textContent = `${viewed.size} of ${ids.length} viewed`;
    bar?.style.setProperty('--layout-viewed', String(viewed.size / ids.length));
    root
      .querySelectorAll<HTMLElement>('[data-pr-tree-file]')
      .forEach((li) => li.toggleAttribute('data-pr-seen', viewed.has(li.dataset.prTreeFile ?? '')));
  };
  const expand = (file: Element, open: boolean) => {
    file.querySelectorAll('[data-pr-more]').forEach((table) => off(table, !open));
    const button = file.querySelector<HTMLButtonElement>('[data-pr-expand]');
    if (!button) return;
    button.setAttribute('aria-expanded', String(open));
    const label = button.querySelector('.pr-exp__t');
    if (label)
      label.textContent = (label.textContent ?? '').replace(/^\w+/, open ? 'Collapse' : 'Expand');
  };
  for (const file of all) {
    const toggle = file.querySelector<HTMLElement>('[data-pr-fold]');
    if (toggle) toggle.hidden = false;
    const row = file.querySelector<HTMLElement>('[data-pr-exp-row]');
    if (row) {
      row.hidden = false;
      expand(file, false);
    }
  }
  const change = (event: Event) => {
    const box = event.target as HTMLInputElement | null;
    const id = box?.dataset?.prViewed;
    if (!box || id === undefined) return;
    if (box.checked) viewed.add(id);
    else viewed.delete(id);
    for (const file of all) {
      if (file.dataset.prFile !== id) continue;
      file.toggleAttribute('data-pr-seen', box.checked);
      fold(file, box.checked);
      const twin = file.querySelector<HTMLInputElement>('[data-pr-viewed]');
      if (twin) twin.checked = box.checked;
    }
    tally();
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const toggle = target?.closest('[data-pr-fold]');
    const more = target?.closest('[data-pr-expand]');
    const file = (toggle ?? more)?.closest<HTMLElement>('[data-pr-file]');
    if (!file) return;
    if (toggle) fold(file, toggle.getAttribute('aria-expanded') === 'true');
    else expand(file, more!.getAttribute('aria-expanded') !== 'true');
  };
  root.addEventListener('change', change);
  root.addEventListener('click', click);
  return () => {
    root.removeEventListener('change', change);
    root.removeEventListener('click', click);
    for (const file of all) {
      fold(file, false);
      expand(file, true);
      file.removeAttribute('data-pr-seen');
      const toggle = file.querySelector<HTMLElement>('[data-pr-fold]');
      if (toggle) toggle.hidden = true;
      const row = file.querySelector<HTMLElement>('[data-pr-exp-row]');
      if (row) row.hidden = true;
    }
    if (count) count.textContent = counted;
    bar?.style.removeProperty('--layout-viewed');
  };
}

/** A unified diff table as a split one: old lines on the start side, new on the end. */
function splitTable(table: HTMLTableElement): HTMLTableElement {
  const out = document.createElement('table');
  out.className = 'pr-diff pr-diff--split';
  out.setAttribute('data-pr-split-of', '');
  if (table.hasAttribute('data-pr-more')) out.setAttribute('data-pr-more', '');
  if (table.hasAttribute('data-pr-off')) out.setAttribute('data-pr-off', '');
  if (table.caption) out.append(table.caption.cloneNode(true));
  const cols = document.createElement('colgroup');
  for (const name of ['pr-c-n', '', 'pr-c-n', '']) {
    const col = document.createElement('col');
    if (name) col.className = name;
    cols.append(col);
  }
  out.append(cols);
  const body = document.createElement('tbody');
  const cell = (tag: 'td', className: string, from?: Element | null, span?: number) => {
    const td = document.createElement(tag);
    td.className = className;
    if (span) td.colSpan = span;
    if (from) td.append(...[...from.childNodes].map((node) => node.cloneNode(true)));
    return td;
  };
  const side = (row: HTMLTableRowElement | undefined, which: 0 | 1, kind: string) => {
    const number = cell('td', 'pr-n', row?.cells[which]);
    number.setAttribute('aria-hidden', 'true');
    const text = cell('td', 'pr-tx', row?.cells[3]);
    text.dataset.l = row ? kind : 'none';
    return [number, text];
  };
  const rows = [...table.tBodies]
    .flatMap((tbody) => [...tbody.rows])
    .map((row) => ({
      row,
      kind:
        row.dataset.l === 'del'
          ? ('del' as const)
          : row.dataset.l === 'add'
            ? ('add' as const)
            : ('other' as const),
    }));
  for (const pair of pairRows(rows)) {
    const tr = document.createElement('tr');
    if ('other' in pair) {
      const row = pair.other;
      if (row.dataset.l === 'ctx') {
        tr.className = 'pr-l';
        tr.dataset.l = 'ctx';
        tr.append(...side(row, 0, 'ctx'), ...side(row, 1, 'ctx'));
      } else {
        tr.className = row.className;
        tr.append(
          cell(
            'td',
            row.cells[row.cells.length - 1]!.className,
            row.cells[row.cells.length - 1],
            4,
          ),
        );
      }
    } else {
      tr.className = 'pr-l';
      tr.dataset.l = 'pair';
      tr.append(...side(pair.del, 0, 'del'), ...side(pair.add, 1, 'add'));
    }
    body.append(tr);
  }
  out.append(body);
  return out;
}

/** The view (part 3): Unified or Split, where a split fits. */
function view(root: HTMLElement): () => void {
  const group = root.querySelector<HTMLElement>('[data-pr-view]');
  if (!group) return () => {};
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('[data-pr-view-as]')];
  const narrow = matchMedia(NARROW);
  const set = (split: boolean) => {
    if (split && !root.querySelector('[data-pr-split-of]'))
      root
        .querySelectorAll<HTMLTableElement>('[data-pr-file] table.pr-diff')
        .forEach((table) => table.after(splitTable(table)));
    root.toggleAttribute('data-pr-split', split);
    for (const button of buttons)
      button.setAttribute('aria-pressed', String((button.dataset.prViewAs === 'split') === split));
  };
  const fit = () => {
    group.hidden = narrow.matches;
    if (narrow.matches) set(false);
  };
  const click = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-pr-view-as]',
    );
    if (button) set(button.dataset.prViewAs === 'split');
  };
  fit();
  group.addEventListener('click', click);
  narrow.addEventListener('change', fit);
  return () => {
    group.removeEventListener('click', click);
    narrow.removeEventListener('change', fit);
    set(false);
    root.querySelectorAll('[data-pr-split-of]').forEach((table) => table.remove());
    group.hidden = true;
  };
}

/** The merge (part 4): the link opens, and the change reads as merged. */
function merge(root: HTMLElement): () => void {
  const texts = new Map<Element, string>();
  const say = (selector: string, words: string) =>
    root.querySelectorAll(selector).forEach((el) => {
      if (!texts.has(el)) texts.set(el, el.textContent ?? '');
      el.textContent = words;
    });
  const event = root.querySelector<HTMLElement>('[data-mark="merge"]');
  const base = root.querySelector('.pr-br')?.textContent ?? '';
  const click = (e: MouseEvent) => {
    if (!(e.target as Element | null)?.closest('a[data-pr-merge]')) return;
    root.setAttribute('data-pr-merged', '');
    say('[data-pr-state-text]', 'Merged');
    say('[data-pr-merge-state]', `Merged into ${base}`);
    say('[data-pr-merge-review]', 'Approved by you');
    say('[data-pr-reviewer]', 'approved');
    if (event) event.hidden = false;
  };
  root.addEventListener('click', click);
  return () => {
    root.removeEventListener('click', click);
    root.removeAttribute('data-pr-merged');
    texts.forEach((text, el) => (el.textContent = text));
    if (event) event.hidden = true;
  };
}

/** Print: every disclosure opens on paper, and closes again after. */
function print(root: HTMLElement): () => void {
  const opened: HTMLDetailsElement[] = [];
  const before = () =>
    root.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((details) => {
      details.open = true;
      opened.push(details);
    });
  const after = () => opened.splice(0).forEach((details) => (details.open = false));
  addEventListener('beforeprint', before);
  addEventListener('afterprint', after);
  return () => {
    removeEventListener('beforeprint', before);
    removeEventListener('afterprint', after);
    after();
  };
}

export default function ReviewEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const boundary = ref.current?.closest('[data-variant]');
    const root = boundary?.querySelector<HTMLElement>('[data-pr-root]');
    if (!root || root.closest('[inert]')) return;
    const stops: (() => void)[] = [];
    for (const part of [tabs, files, view, merge, print]) {
      try {
        stops.push(part(root));
      } catch (error) {
        console.error(error);
      }
    }
    return () => stops.reverse().forEach((stop) => stop());
  }, []);
  // A mark that the enhancement mounted, for the page's own checks.
  return <span ref={ref} hidden data-pr-enhanced={input.variant} />;
}
