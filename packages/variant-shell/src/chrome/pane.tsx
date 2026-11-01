import type { PageOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { commandFor, KIND_LABELS, type TranscriptEntry } from '../model';
import { uiLangOf, Words } from '../parts';

// The index (SH-M3): `ls -R ~`, every section with an anchor, grouped by
// directory in the transcript's order. At 1280 px and up it docks beside
// the transcript, and with the enhancement it collapses to the five
// directories with the current one expanded; below that, and with no
// script, it's an in-flow nav of real links before the end of the session.

/** One row of the index: where it goes, the verb that prints it, and its title. */
export interface PaneRow {
  readonly href: string;
  /** The id of the block on this page it lands on, which the scroll spy marks current. */
  readonly target?: string;
  /** The owner's title, else none and `label` in the composition's words. */
  readonly title?: string;
  readonly label: string;
  readonly verb: string;
  readonly count?: number;
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}

export interface PaneGroup {
  /** The group's head: a directory (`~/work`), or the case page's own (`man <slug>`). */
  readonly cwd: string;
  readonly destination: string;
  /** What the palette calls its rows: Sections, unless the group is a way elsewhere. */
  readonly kind?: 'Sections' | 'Work' | 'Home';
  readonly rows: readonly PaneRow[];
}

/**
 * The index's groups: the transcript's runs of one directory, in its order
 * (SH-M2), so the index and the transcript agree; each row a section with
 * an anchor, and the verb that prints it.
 */
export function paneGroups(
  entries: readonly TranscriptEntry[],
  outline: PageOutline,
  input: VariantRenderInput,
): PaneGroup[] {
  const anchored = new Map(outline.sections.map((section) => [section.id, section]));
  const groups: { cwd: string; destination: string; rows: PaneRow[] }[] = [];
  for (const entry of entries) {
    const section = anchored.get(entry.section.id);
    if (!section?.href) continue;
    const row: PaneRow = {
      href: section.href,
      ...(section.anchor !== undefined ? { target: section.anchor } : {}),
      ...(section.title !== undefined ? { title: section.title } : {}),
      label: KIND_LABELS[section.kind] ?? section.kind,
      verb: commandFor(entry.section, input).verb,
      count: section.count,
      ...(section.lang !== undefined ? { lang: section.lang } : {}),
      ...(section.dir !== undefined ? { dir: section.dir } : {}),
    };
    const last = groups[groups.length - 1];
    if (last && last.cwd === entry.cwd) last.rows.push(row);
    else groups.push({ cwd: entry.cwd, destination: entry.destination ?? 'home', rows: [row] });
  }
  return groups;
}

/** The sections the index lands on in this page: its rows with a block here. */
export const paneTotal = (groups: readonly PaneGroup[]) =>
  groups.reduce((sum, group) => sum + group.rows.filter((row) => row.target).length, 0);

export function Pane({
  input,
  groups,
  id,
  command = 'ls -R ~',
  whole = false,
}: {
  input: VariantRenderInput;
  groups: readonly PaneGroup[];
  id: string;
  /** The command the pane's head shows, shell idiom, hidden from assistive tech. */
  command?: string;
  /** Never folded to the current group: a case page's index is short, and its way home shows. */
  whole?: boolean;
}) {
  const uiLang = uiLangOf(input);
  const total = paneTotal(groups);
  const titleId = `${id}-title`;
  return (
    <nav
      className="sh-pane"
      id={id}
      aria-labelledby={titleId}
      data-sh-pane=""
      data-sh-whole={whole ? '' : undefined}
    >
      <p className="sh-pane__hd">
        <span id={titleId} lang={uiLang}>
          <span aria-hidden="true">{command}</span>
          <span className="sh-sr">Index</span>
        </span>
        <span className="sh-faint" lang={uiLang}>
          {total} sections
        </span>
      </p>
      <div className="sh-pane__list">
        {groups.map((group, g) => (
          <div
            className="sh-grp"
            key={`${group.cwd}-${g}`}
            data-dest={group.destination}
            data-sh-group={group.kind ?? 'Sections'}
          >
            <p className="sh-grp__dn sh-dir" aria-hidden="true">
              {group.cwd}:<span className="sh-faint"> {group.rows.length}</span>
            </p>
            <ul aria-label={group.cwd}>
              {group.rows.map((row) => (
                <li key={row.href}>
                  <a
                    className="sh-row"
                    href={row.href}
                    data-sh-target={row.target}
                    lang={row.lang}
                    dir={row.dir}
                  >
                    {/* The pointer is drawn only on the current row, so a hidden one is no text at all. */}
                    <span className="sh-row__p" aria-hidden="true" />
                    <span className="sh-row__v" aria-hidden="true">
                      {row.verb}
                    </span>
                    <span className="sh-row__ttl">
                      {row.title ?? <Words lang={uiLang}>{row.label}</Words>}
                    </span>
                    <span className="sh-row__n" aria-hidden="true">
                      {row.count !== undefined && row.count > 0 ? row.count : ''}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* The palette's prompt, a button the enhancement shows: the index's own way to search it. */}
      <button
        className="sh-pane__q"
        type="button"
        data-sh-open=""
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K /"
        hidden
      >
        <span className="sh-q__gt" aria-hidden="true">
          &gt;
        </span>
        <span lang={uiLang}>type to jump</span>
        <span className="sh-faint" aria-hidden="true" data-sh-keys="">
          ⌘K or /
        </span>
      </button>
    </nav>
  );
}
