import type { ChronologyEntry, Section } from '@portfolio/schema';
import {
  chronologyOf,
  hrefFor,
  recordAnchor,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { grewOutOf, listed, present, rangeOf } from '../model';
import { Out, Paren, Prose, uiLang, Words } from '../parts';
import { RuledTable } from './ruled-table';

// The chronology (brief §5.1, component 8): a ruled table, When, then the
// role and where, then what it involved. An entry that grew out of another
// sits indented under it with "(grew out of …)".

type Chronology = Extract<Section, { kind: 'chronology' }>;

function Where({ entry, input }: { entry: ChronologyEntry; input: VariantRenderInput }) {
  const org = present(entry.organization) ? (
    entry.organizationUrl ? (
      <a href={hrefFor(entry.organizationUrl, input)}>
        {entry.organization}
        <Out href={entry.organizationUrl} />
      </a>
    ) : (
      entry.organization
    )
  ) : null;
  const rest = [entry.field, entry.location].filter(present).join(', ');
  if (!org && !rest) return null;
  return (
    <span className="ss-sub">
      {org}
      {org && rest ? ', ' : null}
      {rest}
    </span>
  );
}

function Involved({ entry, input }: { entry: ChronologyEntry; input: VariantRenderInput }) {
  const points = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
  const skills = (entry.skills ?? []).filter(present);
  return (
    <>
      {present(entry.description) ? (
        <Prose source={entry.description} input={input} role="body-compact" />
      ) : null}
      {points.length > 0 ? (
        <ul className="ss-ruled ss-ruled--quiet" data-type-role="body-compact">
          {points.map((point, index) => (
            <li key={index} className="ss-num">
              {point}
            </li>
          ))}
        </ul>
      ) : null}
      {skills.length > 0 ? (
        <p className="ss-skills" data-type-role="body-compact">
          <Words lang={uiLang(input.portfolio.locale)}>Skills:</Words>{' '}
          {listed(skills, input.portfolio.locale)}.
        </p>
      ) : null}
    </>
  );
}

export function ChronologyRenderer({ section, input }: SectionRendererProps<Chronology>) {
  const lang = uiLang(input.portfolio.locale);
  const entries = chronologyOf(section, input);
  const shown = new Set(entries.map((entry) => entry.id));
  return (
    <RuledTable
      caption={section.title ?? 'Chronology'}
      lang={lang}
      columns={[
        { label: 'When', span: 2, wide: true },
        { label: entries.every((entry) => entry.kind === 'study') ? 'Study' : 'Role', span: 4 },
        { label: 'What it involved', span: 6, wide: true },
      ]}
      rows={entries.map((entry) => {
        const range = rangeOf(entry.period);
        const parent = grewOutOf(entry, input);
        const when = range ? (
          <span className="ss-num">
            {range.open ? <Words lang={lang}>{range.text}</Words> : range.text}
          </span>
        ) : null;
        return {
          key: entry.id,
          id: recordAnchor(section, entry, input),
          lang: entry.lang,
          branch: parent !== undefined && shown.has(parent.id),
          narrowAt: 1,
          cells: [
            when,
            <>
              <span className="ss-strong" data-type-role="body">
                {entry.title}
              </span>
              <Where entry={entry} input={input} />
              {parent ? (
                <span className="ss-sub">
                  <Paren>
                    <Words lang={lang}>grew out of</Words> {parent.title}
                  </Paren>
                </span>
              ) : null}
            </>,
            <Involved key="i" entry={entry} input={input} />,
          ],
          narrow: (
            <>
              {when ? <span className="ss-sub">{when}</span> : null}
              <Involved entry={entry} input={input} />
            </>
          ),
        };
      })}
    />
  );
}
