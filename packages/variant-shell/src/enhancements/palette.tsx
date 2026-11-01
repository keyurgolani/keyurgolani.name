'use client';

import { useEffect, useRef } from 'react';
import { useDocumentAction } from '@portfolio/kit/runtime';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Shell's one enhancement (brief §5.6 step 8), on a page complete without
// it. It reads the server's markup, never the content:
// 1. the palette: the status line's jump button, mod+k and / (K-4 (d),
//    through the host) open a native dialog with an APG combobox over a
//    listbox of every section, work and link the page holds, grouped
//    (role=group, aria-labelledby), each option named by its plain title,
//    a polite count, Esc to close and focus back where it was;
// 2. the scroll spy: an IntersectionObserver marks the section in view, its
//    pane row and status-line window (aria-current="location"), expands
//    its directory in the docked pane, and writes the n/N counter;
// 3. the caret: once the end of the session is in view, it blinks four
//    times and holds (CSS, under no-preference and full motion only);
// 4. the folds: a fragment into a folded section opens it, and print
//    opens every fold.
// No frame loop, no timer, no scroll listener: idle cost is nothing.

export interface Item {
  readonly group: string;
  /** What it shows, and what a query matches. */
  readonly title: string;
  /** Its name for assistive tech, when that isn't the title (a destination's `~/work`). */
  readonly label?: string;
  readonly href: string;
  /** The language of the words it shows, from its source on the page (WCAG 3.1.2). */
  readonly lang?: string;
}

/** A query's match in a title: the indexes of its characters, in order, or none. */
export function fuzzy(title: string, query: string): number[] | undefined {
  const hay = title.toLowerCase();
  const at: number[] = [];
  let from = 0;
  for (const char of query.toLowerCase().replace(/\s+/g, '')) {
    const i = hay.indexOf(char, from);
    if (i < 0) return undefined;
    at.push(i);
    from = i + 1;
  }
  return at;
}

/** The matches for a query, best first: a contiguous run, then an earlier start, then the page order. */
export function rank(items: readonly Item[], query: string): { item: Item; at: number[] }[] {
  if (query.trim() === '') return items.map((item) => ({ item, at: [] }));
  const spread = (at: number[]) => (at.length ? at[at.length - 1]! - at[0]! : 0);
  return items
    .flatMap((item, order) => {
      const at = fuzzy(item.title, query);
      return at ? [{ item, at, order }] : [];
    })
    .sort((a, b) => spread(a.at) - spread(b.at) || a.at[0]! - b.at[0]! || a.order - b.order)
    .map(({ item, at }) => ({ item, at }));
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * What the palette lists: the five destinations first (so on a phone, with nothing typed,
 * contact is the second tap), then the index's sections, the works with their own pages, and
 * the links, each target once in its group.
 */
function itemsOf(root: Element): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  const add = (group: string, title: string, source: Element, label?: string) => {
    const href = source.getAttribute('href');
    if (!href || !title || seen.has(`${group} ${href}`)) return;
    seen.add(`${group} ${href}`);
    const lang = source.closest('[lang]')?.getAttribute('lang') ?? undefined;
    items.push({ group, title, href, ...(label ? { label } : {}), ...(lang ? { lang } : {}) });
  };
  root
    .querySelectorAll('a.sh-tmux__win')
    .forEach((a) =>
      add(
        'Destinations',
        text(a.querySelector('[aria-hidden]')),
        a,
        text(a.querySelector('.sh-sr')) || undefined,
      ),
    );
  root
    .querySelectorAll('a.sh-row')
    .forEach((a) =>
      add(
        a.closest<HTMLElement>('[data-sh-group]')?.dataset.shGroup ?? 'Sections',
        text(a.querySelector('.sh-row__ttl')),
        a,
      ),
    );
  root
    .querySelectorAll<HTMLElement>('a.sh-ent__nm, a[data-sh-work]')
    .forEach((a) => add('Work', a.dataset.shWork || text(a).replace(/\/$/, ''), a));
  root.querySelectorAll('.sh-kv__list a, .sh-mailto a').forEach((a) => add('Links', text(a), a));
  return items;
}

/**
 * Lands on an in-page target: the hash set (or, when it's already the hash, an explicit
 * scroll), then focus on the target, focusable for as long as it holds focus.
 */
export function land(href: string): void {
  const id = decodeURIComponent(href.slice(1));
  const target = document.getElementById(id);
  unfold(target);
  if (location.hash === href) target?.scrollIntoView({ block: 'start' });
  else location.hash = href;
  if (!target) return;
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}

/** Opens the fold (gate item 8) that holds an element, so a jump into it lands on its content. */
function unfold(target: Element | null): void {
  const fold = target?.closest<HTMLDetailsElement>('details[data-sh-fold]');
  if (fold && !fold.open) fold.open = true;
}

/**
 * The folds (gate item 8): a fragment into one opens it, on arrival and on every hash change
 * (the browser opens it too, where it can, script or none), and every fold, a section's or a
 * row's, prints open, put back as it was after.
 */
function folds(root: Element): () => void {
  const target = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    return id ? document.getElementById(id) : null;
  };
  const changed = () => unfold(target());
  const opened: HTMLDetailsElement[] = [];
  const before = () => {
    root
      .querySelectorAll<HTMLDetailsElement>(
        'details:is([data-sh-fold], [data-sh-more]):not([open])',
      )
      .forEach((fold) => {
        fold.open = true;
        opened.push(fold);
      });
  };
  const after = () => {
    for (const fold of opened.splice(0)) fold.open = false;
  };
  changed();
  addEventListener('hashchange', changed);
  addEventListener('beforeprint', before);
  addEventListener('afterprint', after);
  return () => {
    removeEventListener('hashchange', changed);
    removeEventListener('beforeprint', before);
    removeEventListener('afterprint', after);
  };
}

function palette(root: Element, dialog: HTMLDialogElement): { open: () => void; stop: () => void } {
  const input = dialog.querySelector<HTMLInputElement>('[data-sh-query]')!;
  const list = dialog.querySelector<HTMLElement>('[data-sh-list]')!;
  const count = dialog.querySelector<HTMLElement>('[data-sh-count-live]')!;
  const items = itemsOf(root);
  let options: HTMLElement[] = [];
  let active = -1;
  let back: HTMLElement | null = null;
  const base = dialog.id;
  const select = (next: number) => {
    options[active]?.setAttribute('aria-selected', 'false');
    active = options.length ? (next + options.length) % options.length : -1;
    const option = options[active];
    if (option) {
      option.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const draw = () => {
    const found = rank(items, input.value);
    list.replaceChildren();
    options = [];
    const groups = new Map<string, HTMLElement>();
    found.forEach(({ item, at }) => {
      let group = groups.get(item.group);
      if (!group) {
        const label = document.createElement('p');
        label.id = `${base}-g${groups.size}`;
        label.className = 'sh-dlg__g';
        label.textContent = item.group;
        group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-labelledby', label.id);
        group.append(label);
        list.append(group);
        groups.set(item.group, group);
      }
      const option = document.createElement('div');
      option.id = `${base}-o${options.length}`;
      option.className = 'sh-row';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.setAttribute('aria-label', item.label ?? item.title);
      option.dataset.href = item.href;
      if (item.lang) option.lang = item.lang;
      const title = document.createElement('span');
      title.className = 'sh-row__ttl';
      const marks = new Set(at);
      [...item.title].forEach((char, i) => {
        if (marks.has(i)) {
          const mark = document.createElement('mark');
          mark.textContent = char;
          title.append(mark);
        } else title.append(char);
      });
      option.append(title);
      group.append(option);
      options.push(option);
    });
    count.textContent = `${options.length} ${options.length === 1 ? 'match' : 'matches'}`;
    active = -1;
    select(0);
  };
  const go = (option: HTMLElement | undefined) => {
    const href = option?.dataset.href;
    if (!href) return;
    // A jump moves focus to where it lands: the opener doesn't get it back.
    back = null;
    dialog.close();
    if (href.startsWith('#')) land(href);
    else location.assign(href);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(options[active]);
    }
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    if (target === dialog || target.closest('[data-sh-close]')) dialog.close();
    else go(target.closest<HTMLElement>('[role="option"]') ?? undefined);
  };
  // Escape or the backdrop: focus goes back where it was, without moving the page.
  const closed = () => {
    back?.focus({ preventScroll: true });
    back = null;
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', keys);
  dialog.addEventListener('click', click);
  dialog.addEventListener('close', closed);
  const open = () => {
    if (dialog.open) return;
    back = document.activeElement as HTMLElement | null;
    input.value = '';
    draw();
    dialog.showModal();
    // On a touch screen the field waits for a tap: focused now, it would raise the keyboard
    // over the list, and the destinations at its head with it. The list is a tap away.
    if (matchMedia('(pointer: coarse)').matches) {
      dialog.tabIndex = -1;
      dialog.focus();
    } else input.focus();
  };
  return {
    open,
    stop: () => {
      input.removeEventListener('input', draw);
      input.removeEventListener('keydown', keys);
      dialog.removeEventListener('click', click);
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
      list.replaceChildren();
    },
  };
}

function spy(root: Element): () => void {
  const blocks = [...root.querySelectorAll<HTMLElement>('.sh-block')];
  const rows = new Map(
    [...root.querySelectorAll<HTMLAnchorElement>('.sh-row[data-sh-target]')].map((a) => [
      a.dataset.shTarget,
      a,
    ]),
  );
  const wins = [...root.querySelectorAll<HTMLAnchorElement>('.sh-tmux__win')];
  const pos = root.querySelector<HTMLElement>('[data-sh-count]');
  const pane = root.querySelector<HTMLElement>('[data-sh-pane]');
  const cur = root.querySelector<HTMLElement>('[data-sh-cur]');
  const total = Number(pos?.dataset.shCount ?? blocks.length);
  const seen = new Set<HTMLElement>();
  let last: HTMLElement | undefined = blocks[0];
  // A folded section (gate item 8) has no box of its own while closed: its fold, the summary
  // that reads as its lines, stands for it, so a directory of folds still becomes the current
  // one, and the docked index opens it to the pointer.
  const boxOf = (block: HTMLElement) =>
    block.closest<HTMLElement>('details[data-sh-fold]') ?? block;
  const mark = () => {
    // The section crossing the reading line; else, where the line falls between two (the gap
    // under a short fold, after a jump), the last one starting above it; past the last section
    // (the index, the footer), the last one read.
    const line = innerHeight * 0.1;
    const block =
      blocks.filter((each) => seen.has(each)).pop() ??
      blocks.filter((each) => boxOf(each).getBoundingClientRect().top <= line).pop() ??
      (scrollY > 0 ? last : blocks[0]);
    last = block;
    if (!block) return;
    const dest = block.dataset.dest;
    rows.forEach((row, id) => {
      if (id === block.id) row.setAttribute('aria-current', 'location');
      else row.removeAttribute('aria-current');
    });
    const own = rows.get(block.id);
    pane?.querySelectorAll<HTMLElement>('.sh-grp').forEach((group) => {
      group.toggleAttribute('data-current', own ? group.contains(own) : false);
    });
    wins.forEach((win) => {
      if (dest === win.dataset.dest) win.setAttribute('aria-current', 'location');
      else win.removeAttribute('aria-current');
    });
    if (pos) pos.textContent = `${blocks.indexOf(block) + 1}/${total}`;
    if (cur) cur.textContent = block.dataset.cwd ?? cur.dataset.shCur ?? '~';
  };
  const blockOf = new Map(blocks.map((block) => [boxOf(block), block]));
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const block = blockOf.get(entry.target as HTMLElement);
        if (!block) continue;
        if (entry.isIntersecting) seen.add(block);
        else seen.delete(block);
      }
      mark();
    },
    // A line a tenth of the way down: the section crossing it is the one being read, and a
    // jump's target, set just under the top by its scroll margin, is crossing it as it lands.
    { rootMargin: '-10% 0px -89% 0px' },
  );
  blockOf.forEach((_, box) => watch.observe(box));
  pane?.setAttribute('data-sh-spy', '');
  // A focus that arrives on a folded row (a script's, a screen reader's) unfolds the index
  // until focus leaves the pane: the mark is the focus's arrival, not where its row is now,
  // so a row a pointer pressed, still focused when the reading moves into another directory,
  // doesn't unfold it. The same focus back after the window lost it isn't an arrival.
  let away: Element | null = null;
  // A pointer's press: the row it focuses stays where the pointer found it, whatever the index
  // did before (a keyboard user who unfolded it and then presses a row still clicks that row).
  let pressed = false;
  const press = () => {
    pressed = true;
  };
  const release = () => {
    pressed = false;
  };
  // A folded row unfolds as it takes focus, after the browser scrolled its empty box into
  // view: the docked list brings the row itself into its scrollport. Only for the keyboard, or
  // a folded row (no pointer can press one): a pressed row stays where the pointer found it,
  // or the scroll would move it and the click would land on its neighbour.
  const reveal = (event: Event) => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('.sh-row');
    if (!row || !pane) return;
    const back = target === away;
    away = null;
    if (back) return;
    // Folded as the focus arrives: its directory's list closed to nothing.
    const folded = row.closest('ul')?.getBoundingClientRect().height === 0;
    if (folded) pane.setAttribute('data-sh-unfold', '');
    const keyboard = !pressed && (target.matches(':focus-visible') || folded);
    if (keyboard && getComputedStyle(pane).position === 'sticky') {
      row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  };
  const leave = (event: FocusEvent) => {
    if (!pane) return;
    // The window lost focus and the row keeps it: nothing left the pane.
    if (document.activeElement === event.target) {
      away = event.target as Element;
      return;
    }
    away = null;
    if (!pane.contains(event.relatedTarget as Node | null)) pane.removeAttribute('data-sh-unfold');
  };
  pane?.addEventListener('pointerdown', press, true);
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  pane?.addEventListener('focusin', reveal);
  pane?.addEventListener('focusout', leave);
  mark();
  return () => {
    watch.disconnect();
    pane?.removeEventListener('pointerdown', press, true);
    removeEventListener('pointerup', release, true);
    removeEventListener('pointercancel', release, true);
    pane?.removeEventListener('focusin', reveal);
    pane?.removeEventListener('focusout', leave);
    pane?.removeAttribute('data-sh-unfold');
    // Back to the server's markup: no spy, nothing current, the counter as it was.
    pane?.removeAttribute('data-sh-spy');
    root
      .querySelectorAll('[aria-current="location"]')
      .forEach((el) => el.removeAttribute('aria-current'));
    root.querySelectorAll('[data-current]').forEach((el) => el.removeAttribute('data-current'));
    if (pos) pos.textContent = `${total} sections`;
    if (cur) cur.textContent = cur.dataset.shCur || '~';
  };
}

/**
 * K-12 removes this.
 * The status line is fixed on the block end, and a browser scrolls focus into view as if
 * nothing covered the window's bottom: a stop Tab reaches under the bar comes out above it,
 * its ring and a row clear (WCAG 2.4.11). Keyboard focus alone, never a click's (the page
 * would move between press and release) nor a container or landing focused by script
 * (main's tabIndex is -1, as is a jump's target): only a stop the bar really covers, short
 * enough to clear it, outside the docked index (which is fitted above the bar and doesn't
 * scroll with the page), and at once. Its own box is aligned, never a tall one's tail.
 */
function clearance(root: Element): () => void {
  const bar = root.querySelector<HTMLElement>('[data-sh-tmux]');
  if (!bar) return () => {};
  const lift = (event: Event) => {
    const stop = event.target as HTMLElement | null;
    if (!stop || !stop.matches(':focus-visible') || stop.tabIndex < 0) return;
    if (bar.contains(stop) || stop.closest('dialog')) return;
    const pane = stop.closest<HTMLElement>('[data-sh-pane]');
    if (pane && getComputedStyle(pane).position !== 'static') return;
    const box = stop.getBoundingClientRect();
    const edge = bar.getBoundingClientRect().top;
    const style = getComputedStyle(stop);
    // Its ring counts: a stop whose box clears the bar but whose ring doesn't is still covered,
    // and the browser, seeing the box in view, won't move it.
    const ring =
      (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
    if (box.bottom + ring <= edge) return;
    const row = parseFloat(style.scrollMarginBlockStart) || 0;
    if (box.height + row * 2 >= edge) return;
    // Whole pixels, rounded up: a fraction short would leave the ring's last pixel under the bar.
    scrollBy({ top: Math.ceil(box.bottom - edge + Math.max(row, ring)), behavior: 'instant' });
  };
  root.addEventListener('focusin', lift);
  return () => root.removeEventListener('focusin', lift);
}

function caret(root: Element): () => void {
  const end = root.querySelector<HTMLElement>('[data-sh-end]');
  if (!end) return () => {};
  const watch = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      end.classList.add('is-live');
      watch.disconnect();
    }
  });
  watch.observe(end);
  return () => {
    watch.disconnect();
    end.classList.remove('is-live');
  };
}

export default function PaletteEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const opener = useRef<() => void>(() => {});
  useDocumentAction('palette.open', () => opener.current());
  useEffect(() => {
    const root = ref.current?.closest('[data-variant]') ?? document.body;
    if (!root || root.closest('[inert]')) return;
    const stops: (() => void)[] = [];
    const attach = (part: () => () => void) => {
      try {
        stops.push(part());
      } catch (error) {
        console.error(error);
      }
    };
    const dialog = root.querySelector<HTMLDialogElement>('[data-sh-dialog]');
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-sh-jump], [data-sh-open]')];
    const link = root.querySelector<HTMLElement>('[data-sh-jump-link]');
    if (dialog && buttons.length > 0) {
      attach(() => {
        const { open, stop } = palette(root, dialog);
        opener.current = open;
        // The shortcut as this platform spells it: Cmd on an Apple one, Ctrl elsewhere.
        const apple = /Mac|iPhone|iPad/.test(navigator.platform);
        root.querySelectorAll<HTMLElement>('[data-sh-keys]').forEach((keys) => {
          keys.hidden = false;
          keys.textContent = (keys.textContent ?? '').replace('⌘K', apple ? '⌘K' : 'Ctrl K');
        });
        for (const button of buttons) {
          button.hidden = false;
          button.addEventListener('click', open);
        }
        // Marked, not hidden: the platform hides [hidden] even on paper, where the link prints.
        link?.setAttribute('data-sh-off', '');
        return () => {
          stop();
          for (const button of buttons) {
            button.removeEventListener('click', open);
            button.hidden = true;
          }
          link?.removeAttribute('data-sh-off');
          opener.current = () => {};
        };
      });
    }
    attach(() => folds(root));
    attach(() => spy(root));
    attach(() => caret(root));
    attach(() => clearance(root));
    return () => stops.forEach((stop) => stop());
  }, []);
  // A mark that the enhancement mounted, for the page's own checks.
  return <span ref={ref} hidden data-sh-enhanced={input.variant} />;
}
