import { AXES, optionNote, type AppearanceCatalog } from '../studio/appearance';
import type { DemoSelection } from './url-state';
import { MEMORY_ONLY_NOTICE } from './storage';

// Demo Studio's state lines (#9, design note section 2): what the shell's
// "Where things stand" shows under demo, in place of the owner's draft and
// publish lines. Nothing here names a draft, a publish, or the live site,
// since the demo has none of them. Framework-free, so a test drives it.

/** The approved sandbox line (Codex [23]): "Demo sandbox", a spaced em dash, then the rest. */
export const SANDBOX_LINE = 'Demo sandbox — only you can see these changes';

export interface DemoStateLine {
  readonly id: 'content' | 'appearance' | 'storage';
  readonly label: string;
  readonly text: string;
  readonly tone: 'neutral' | 'attention';
}

/** The name the catalog gives `value` on its axis, or the value itself, with what renders in its place. */
function named(catalog: AppearanceCatalog, axis: (typeof AXES)[number], value: string): string {
  const note = optionNote(catalog, axis, value);
  if (note.option) return note.option.name;
  return note.fallback ? `${value}, shown as ${note.fallback}` : value;
}

/** The lines for `selection`, with `persistent` saying whether it outlasts the page. */
export function demoStateLines(
  catalog: AppearanceCatalog,
  selection: DemoSelection,
  persistent: boolean,
): readonly DemoStateLine[] {
  const labels = new Map(catalog.axes.map(({ axis, label }) => [axis, label]));
  return [
    {
      id: 'content',
      label: 'Content',
      text: 'The neutral sample portfolio, read-only.',
      tone: 'neutral',
    },
    {
      id: 'appearance',
      label: 'Appearance',
      text: AXES.map(
        (axis) => `${labels.get(axis) ?? axis}: ${named(catalog, axis, selection[axis])}`,
      ).join('; '),
      tone: 'neutral',
    },
    persistent
      ? {
          id: 'storage',
          label: 'This browser',
          text: 'Your choices are kept in this browser, and nowhere else.',
          tone: 'neutral',
        }
      : { id: 'storage', label: 'This browser', text: MEMORY_ONLY_NOTICE, tone: 'attention' },
  ];
}
