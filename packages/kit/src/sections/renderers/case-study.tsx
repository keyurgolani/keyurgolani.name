import type { ReactNode } from 'react';
import type { CaseStudy as CaseStudyFields, Work } from '@portfolio/schema';
import {
  CASE_STUDY_FIELDS,
  FIELDS_AFTER,
  FIELDS_BEFORE,
  type CaseStudyField,
} from '../case-study-fields';
import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
import { deeper, Heading, present, Ui, type RenderContext } from '../primitives';
import type { HeadingLevel } from '../types';
import { RichText } from '../rich-text';
import { evidenceByIds, isSignature } from '../view';
import { EvidenceEntry } from './evidence';

// A work's case study (#10, slice 1, item 7), for the /work/<slug> view
// that #10's next slice serves: the fixed label Case study, the work's title
// as the page's one heading at `level`, its cover (lazy, as every image
// but the signature cover is), then each field the owner
// wrote, under its fixed label, one level down: Challenge, Context, Role,
// Constraints, Decisions, Evidence, Outcomes, and Reflection. A field the
// owner didn't write has no heading at all. Each decision shows its
// rationale and alternatives under those labels, one level further down.

/** The fields shown before the decisions and after the evidence, from the one list caseStudyOutline() reads. */
const BEFORE = FIELDS_BEFORE;
const AFTER = FIELDS_AFTER;
/** Each part's label, by its key. */
const LABEL: Readonly<Record<CaseStudyField, string>> = Object.fromEntries(
  CASE_STUDY_FIELDS,
) as Record<CaseStudyField, string>;

/** One field under its fixed label. */
function Field({
  label,
  level,
  ctx,
  children,
}: {
  label: string;
  level: HeadingLevel;
  ctx: RenderContext;
  children: ReactNode;
}) {
  return (
    <section className="pf-case-study__field">
      <Heading level={level} className="pf-case-study__heading">
        <Ui ctx={ctx}>{label}</Ui>
      </Heading>
      {children}
    </section>
  );
}

export interface CaseStudyProps {
  /** A work with a case study. */
  readonly work: Work & { readonly caseStudy: CaseStudyFields };
  readonly ctx: RenderContext;
  /** The title's level: 1 on the work's own page, which it heads. */
  readonly level?: HeadingLevel;
}

/** The work's case study, as its own page shows it. */
export function CaseStudy({ work, ctx, level = 1 }: CaseStudyProps) {
  const { input } = ctx;
  const study = work.caseStudy;
  const fieldLevel = deeper(level);
  const decisionLevel = deeper(fieldLevel);
  const decisions = study.decisions ?? [];
  const evidence = evidenceByIds(work.evidence, input);
  const cover = placedMedia(work.cover, ctx);
  // The work's evidence records sit under Evidence, below the field's headings.
  const nested: RenderContext = { ...ctx, level: fieldLevel, itemLevel: decisionLevel };
  return (
    <article className="pf-case-study" data-work-id={work.id} lang={work.lang}>
      <header className="pf-case-study__header">
        <p className="pf-case-study__label">
          <Ui ctx={ctx}>Case study</Ui>
        </p>
        <Heading level={level} className="pf-case-study__title">
          {work.title}
        </Heading>
      </header>
      {cover ? (
        <MediaFigure
          placed={cover}
          ctx={ctx}
          className="pf-cover"
          eager={isSignature(work, input)}
        />
      ) : null}
      {BEFORE.filter(([key]) => present(study[key])).map(([key, label]) => (
        <Field key={key} label={label} level={fieldLevel} ctx={ctx}>
          <RichText source={study[key]!} input={input} />
        </Field>
      ))}
      {decisions.length > 0 ? (
        <Field label={LABEL.decisions} level={fieldLevel} ctx={ctx}>
          <ol className="pf-decisions">
            {decisions.map((decision, index) => (
              <li key={index} className="pf-decision">
                <RichText
                  source={decision.decision}
                  className="pf-decision__text"
                  typeRole="title"
                  input={input}
                />
                {present(decision.rationale) ? (
                  <>
                    <Heading
                      level={decisionLevel}
                      className="pf-decision__label"
                      typeRole="caption"
                    >
                      <Ui ctx={ctx}>Rationale</Ui>
                    </Heading>
                    <RichText source={decision.rationale} input={input} />
                  </>
                ) : null}
                {present(decision.alternatives) ? (
                  <>
                    <Heading
                      level={decisionLevel}
                      className="pf-decision__label"
                      typeRole="caption"
                    >
                      <Ui ctx={ctx}>Alternatives</Ui>
                    </Heading>
                    <RichText source={decision.alternatives} input={input} />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </Field>
      ) : null}
      {present(study.evidence) || evidence.length > 0 ? (
        <Field label={LABEL.evidence} level={fieldLevel} ctx={ctx}>
          {present(study.evidence) ? <RichText source={study.evidence} input={input} /> : null}
          {evidence.length > 0 ? (
            <ul className="pf-evidence" role="list">
              {evidence.map((entry) => (
                <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
              ))}
            </ul>
          ) : null}
        </Field>
      ) : null}
      {AFTER.filter(([key]) => present(study[key])).map(([key, label]) => (
        <Field key={key} label={label} level={fieldLevel} ctx={ctx}>
          <RichText source={study[key]!} input={input} />
        </Field>
      ))}
    </article>
  );
}
