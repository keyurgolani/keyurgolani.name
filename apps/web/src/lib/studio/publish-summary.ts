import {
  AXES,
  appearanceOfSite,
  canonicalState,
  optionNote,
  type AppearanceCatalog,
  type AppearanceState,
} from './appearance';
import { shortRevision, type LiveState, type StudioDraft } from './documents';
import { blockingCount, draftFindings } from './publication';

// What the workspace's publish confirmation says (the round 4 design review's
// P1-9, the Studio mockup's studio-owner-publish): the draft version it
// publishes, the live revision that version replaces and what it becomes,
// what changes for visitors on each appearance axis, and the checks on that
// version. Publish stays off, with the reason, until every check passes.

export interface PublishSummary {
  /** "Publish draft 16?" */
  readonly heading: string;
  /** "It becomes revision 13 and replaces revision 12." */
  readonly lede: string;
  /** An appearance axis that changes, and what visitors may choose, each a row. */
  /**
   * Each change visitors see. `note` is a quiet second line: the id of a value Studio doesn't
   * offer, which the value names in words.
   */
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly note?: string;
  }[];
  /** "All checks pass on draft 16." */
  readonly checks: string;
  /** Whether every check passes, so the line reads as a pass. */
  readonly passes: boolean;
  /** The confirming button's words: "Publish revision 13". */
  readonly action: string;
  /** Why it can't go, when it can't, in a sentence; null when it can. */
  readonly reason: string | null;
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** The axes visitors may choose, by their labels, in AXES order. */
function choices(catalog: AppearanceCatalog, state: AppearanceState | null): string {
  if (!state) return '';
  const label = (axis: string) => catalog.axes.find((entry) => entry.axis === axis)?.label ?? axis;
  const open = AXES.filter((axis) => state.controls[axis] === 'selectable').map(label);
  return open.length === 0 ? 'Nothing' : open.join(', ');
}

export function publishSummary({
  draft,
  live,
  liveSite,
  catalog,
  blocker,
}: {
  readonly draft: StudioDraft;
  readonly live: LiveState | null;
  /** The live revision's site document, as read, or null before it's read or when nothing's live. */
  readonly liveSite: unknown;
  readonly catalog: AppearanceCatalog;
  /** publishBlocker()'s words for why the draft can't go, or null. */
  readonly blocker: string | null;
}): PublishSummary {
  const liveId = live?.liveRevisionId ?? null;
  const seq = live?.seq ?? null;
  const current =
    liveId === null ? null : seq !== null ? `revision ${seq}` : `revision ${shortRevision(liveId)}`;
  const next = seq !== null ? seq + 1 : null;
  const lede =
    current === null
      ? 'It becomes the first live revision.'
      : next !== null
        ? `It becomes revision ${next} and replaces ${current}.`
        : `It becomes a new revision and replaces ${current}.`;

  // Each side's retired ids read as their survivors (LANG-1), so ant-inspired against
  // primer-inspired is no change, and no row says it is.
  const before =
    liveSite === null || liveSite === undefined
      ? null
      : canonicalState(catalog, appearanceOfSite(liveSite));
  const after = canonicalState(catalog, appearanceOfSite(draft.documents.site.model));
  const labelOf = (axis: string) =>
    catalog.axes.find((entry) => entry.axis === axis)?.label ?? axis;
  // A value Studio doesn't list, as a live composition no longer registered, says so in words,
  // its id on the row's quiet second line, never as a name the owner should know (P2-1).
  const offered = (axis: (typeof AXES)[number], value: string) =>
    optionNote(catalog, axis, value).option?.name ?? null;
  const nameOf = (axis: (typeof AXES)[number], value: string) =>
    offered(axis, value) ?? `A ${labelOf(axis).toLowerCase()} Studio no longer offers`;
  const rows: { label: string; value: string; note?: string }[] = [];
  if (after) {
    for (const axis of AXES) {
      const from = before?.selection[axis];
      const to = after.selection[axis];
      if (from !== undefined && from !== to) {
        const unoffered = [from, to].filter((each) => offered(axis, each) === null);
        rows.push({
          label: labelOf(axis),
          value: `${nameOf(axis, from)} → ${nameOf(axis, to)}`,
          ...(unoffered.length > 0 ? { note: unoffered.join(', ') } : {}),
        });
      }
    }
    const was = choices(catalog, before);
    const now = choices(catalog, after);
    if (before === null || was !== now) rows.push({ label: 'Visitors can choose', value: now });
  }

  const views = draftFindings(draft);
  const blocking = blockingCount(draft);
  const warnings = views.length - blocking;
  const passes = blocking === 0;
  const checks = passes
    ? warnings === 0
      ? `All checks pass on draft ${draft.version}.`
      : `Checks pass on draft ${draft.version}, with ${plural(warnings, 'warning')}.`
    : `${plural(blocking, 'finding')} on draft ${draft.version} ${blocking === 1 ? 'blocks' : 'block'} publishing.`;
  return {
    heading: `Publish draft ${draft.version}?`,
    lede,
    rows,
    checks,
    passes,
    action: next !== null ? `Publish revision ${next}` : `Publish draft ${draft.version}`,
    reason: blocker === null ? null : `Not ready to publish: ${blocker}.`,
  };
}
