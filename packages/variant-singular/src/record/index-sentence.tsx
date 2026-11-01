import type { PageOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { recordIndex } from '../model';
import { uiLang, Words } from '../parts';

// The record's index (brief §5.7, step 5): one sentence per destination,
// K-1's five in their fixed order, each naming its sections as links in
// reading order: "Work Essays, Incident History. Record Experience, …".
// It's the page's full index, so it's the Contents dialog's second half too.

export function IndexSentence({
  input,
  outline,
  className,
}: {
  input: VariantRenderInput;
  outline: PageOutline;
  className?: string;
}) {
  const groups = recordIndex(input, outline);
  if (groups.length === 0) return null;
  return (
    <p className={className ?? 'sg-index'}>
      {groups.map((group, g) => (
        <span key={group.id} className="sg-index__group">
          {g > 0 ? ' ' : null}
          <b>{group.lang ? <Words lang={group.lang}>{group.label}</Words> : group.label}</b>{' '}
          {group.sections.map((entry, i) => (
            <span key={entry.id}>
              {i > 0 ? ', ' : null}
              <a href={entry.href}>
                {entry.own ? (
                  entry.title
                ) : (
                  <Words lang={uiLang(input.portfolio.locale)}>{entry.title}</Words>
                )}
              </a>
            </span>
          ))}
          .
        </span>
      ))}
    </p>
  );
}
