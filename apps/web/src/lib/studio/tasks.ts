// Studio's task navigation (#8, Slice 1): the owner's seven tasks, in the
// order the shell lists them, each with the capability it needs from the
// page's policy. This pull request builds the content task's expert source
// mode and the validation summary. The rest show an empty state that says
// which of #8's pull requests brings them, until it does.

export type TaskId =
  'content' | 'case-studies' | 'media' | 'appearance' | 'site' | 'validation' | 'history';

export interface StudioTask {
  readonly id: TaskId;
  readonly label: string;
  /** The capability the task needs: the shell lists a task only when the policy allows it. */
  readonly capability: string;
  /** What the task shows until it's built, or null once it is. */
  readonly pending: string | null;
}

export const STUDIO_TASKS: readonly StudioTask[] = Object.freeze([
  { id: 'content', label: 'Content', capability: 'draft.read', pending: null },
  {
    id: 'case-studies',
    label: 'Case studies and artifacts',
    capability: 'draft.read',
    pending:
      'Structured editing for case studies and artifacts arrives with the next Studio release. Until then, edit them in the content source.',
  },
  {
    id: 'media',
    label: 'Media',
    capability: 'asset.write',
    pending:
      'The media library arrives with a later Studio release. Until then, edit the media document in the content source.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    capability: 'draft.write',
    pending:
      "The appearance workspace, with a preview of the draft, arrives with a later Studio release. Until then, edit the site document's appearance in the content source.",
  },
  {
    id: 'site',
    label: 'Site behavior',
    capability: 'draft.write',
    pending:
      'Structured site settings arrive with the next Studio release. Until then, edit the site document in the content source.',
  },
  { id: 'validation', label: 'Validation', capability: 'draft.read', pending: null },
  {
    id: 'history',
    label: 'Publish history',
    capability: 'history.read',
    pending:
      'Publish history, with each revision and a rollback, arrives with a later Studio release.',
  },
]);

/** The tasks `allowed` grants, in STUDIO_TASKS order. */
export function tasksFor(allowed: readonly string[]): readonly StudioTask[] {
  return STUDIO_TASKS.filter((task) => allowed.includes(task.capability));
}
