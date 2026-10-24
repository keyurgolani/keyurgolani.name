import { findingsOf, shortRevision } from './documents';
import { isDirty, type DraftSession } from './draft-session';
import { publishBlocker } from './publication';

// Studio's textual state model (#8, Slice 1; AC1): one line for each state
// the owner has to tell apart, always on screen, each saying in words where
// the work stands. A line's tone styles it, and never carries meaning the
// words don't: nothing is told by color alone.
//
//   local      unsaved edits in this browser, or none
//   draft      the saved draft and its version, or none
//   preview    a preview shows the saved draft, never the live site
//   checks     whether the saved draft validates
//   publish    ready to publish, or why not
//   published  the published revision the draft starts from
//   live       the revision live now
//
// The publish line says what the Publish history task's publish does: ready
// only for the saved version #3 checked, with nothing unsaved over it.

export type StateId = 'local' | 'draft' | 'preview' | 'checks' | 'publish' | 'published' | 'live';

export interface StateLine {
  readonly id: StateId;
  /** What the line is about, as its term. */
  readonly label: string;
  /** Where it stands, in words. */
  readonly text: string;
  /** How it's styled: `attention` for something the owner has to act on. */
  readonly tone: 'neutral' | 'ok' | 'attention';
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export { shortRevision };

/** The state lines for `session`, in StateId order. */
export function stateLines(session: DraftSession): readonly StateLine[] {
  const { draft, conflict } = session;
  const live = session.live;
  const dirty = isDirty(session);
  const findings = draft ? findingsOf(draft) : [];
  const blocking = findings.filter(({ severity }) => severity !== 'warning').length;
  const warnings = findings.length - blocking;

  const local: StateLine = conflict
    ? {
        id: 'local',
        label: 'This browser',
        text: 'Unsaved changes that conflict with a newer saved draft. Choose which to keep.',
        tone: 'attention',
      }
    : dirty
      ? {
          id: 'local',
          label: 'This browser',
          text: session.restored
            ? 'Unsaved changes, restored from this browser. Save them to the draft.'
            : 'Unsaved changes, kept in this browser until you save.',
          tone: 'attention',
        }
      : { id: 'local', label: 'This browser', text: 'No unsaved changes.', tone: 'neutral' };

  const saved: StateLine = draft
    ? {
        id: 'draft',
        label: 'Draft',
        text: `Saved draft, version ${draft.version}.`,
        tone: 'neutral',
      }
    : { id: 'draft', label: 'Draft', text: 'No saved draft yet.', tone: 'neutral' };

  const preview: StateLine = {
    id: 'preview',
    label: 'Preview',
    text: draft
      ? dirty
        ? 'A preview shows the saved draft, not your unsaved changes, and is never live.'
        : 'A preview shows the saved draft, and is never live.'
      : 'Nothing to preview until a draft is saved.',
    tone: 'neutral',
  };

  const checks: StateLine = !draft
    ? { id: 'checks', label: 'Checks', text: 'Not checked: no saved draft.', tone: 'neutral' }
    : blocking > 0
      ? {
          id: 'checks',
          label: 'Checks',
          text: `Validation failed: ${plural(blocking, 'finding')} in the saved draft ${blocking === 1 ? 'blocks' : 'block'} publishing.`,
          tone: 'attention',
        }
      : {
          id: 'checks',
          label: 'Checks',
          text: `The saved draft validates${warnings > 0 ? `, with ${plural(warnings, 'warning')}` : ''}.${dirty ? ' Save to check your changes.' : ''}`,
          tone: 'ok',
        };

  // The publish task's own rule, so the line and the button never disagree.
  const why = publishBlocker(session);
  const publish: StateLine =
    why === null
      ? {
          id: 'publish',
          label: 'Publish',
          text: `Ready to publish version ${draft!.version}.`,
          tone: 'ok',
        }
      : { id: 'publish', label: 'Publish', text: `Not ready to publish: ${why}.`, tone: 'neutral' };

  const published: StateLine = {
    id: 'published',
    label: 'Published revision',
    text: !draft
      ? 'No draft, so no published revision it starts from.'
      : draft.baseRevisionId
        ? `The draft starts from published revision ${shortRevision(draft.baseRevisionId)}.`
        : 'The draft starts from no published revision.',
    tone: 'neutral',
  };

  const moved =
    draft && live && live.liveRevisionId !== draft.baseRevisionId
      ? ' It has changed since the draft started.'
      : '';
  const liveLine: StateLine = !live
    ? { id: 'live', label: 'Live', text: 'Live revision unknown.', tone: 'attention' }
    : live.state === 'empty' || live.liveRevisionId === null
      ? { id: 'live', label: 'Live', text: `Nothing is live yet.${moved}`, tone: 'neutral' }
      : live.state === 'live'
        ? {
            id: 'live',
            label: 'Live',
            text: `Revision ${shortRevision(live.liveRevisionId)}${live.seq === null ? '' : `, number ${live.seq}`}, is live.${moved}`,
            tone: 'neutral',
          }
        : {
            id: 'live',
            label: 'Live',
            text:
              live.servingRevisionId && live.servingRevisionId !== live.liveRevisionId
                ? `Revision ${shortRevision(live.liveRevisionId)} is live but can't be served, so ${shortRevision(live.servingRevisionId)}, the last known good, serves.${moved}`
                : `Revision ${shortRevision(live.liveRevisionId)} is live but can't be served.${moved}`,
            tone: 'attention',
          };

  return [local, saved, preview, checks, publish, published, liveLine];
}
