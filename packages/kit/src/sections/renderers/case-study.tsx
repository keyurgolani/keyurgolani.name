import type { ReactNode } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Heading, present, Ui, type RenderContext } from '../primitives';
import type { HeadingLevel } from '../types';
import { RichText } from '../rich-text';

// A work's case study (#10, slice 1, item 7), for the /work/<slug> view
// that #10's next slice serves: the work's title as the page's one heading
// at `level`, under the fixed label Case study, then each field the owner
// wrote, under its fixed label, one level down. A field the owner didn't
// write has no heading at all. Decisions list each decision with its
// rationale and alternatives under their own labels, one level further.

/** One decision, as the case study records it. */
export interface CaseStudyDecision {
  readonly decision: string;
  readonly rationale?: string;
  readonly alternatives?: string | readonly string[];
}

/** What a case study can hold. Long text is Markdown. */
export interface CaseStudyFields {
  readonly challenge?: string;
  readonly context?: string;
  readonly role?: string;
  readonly constraints?: string | readonly string[];
  readonly decisions?: readonly CaseStudyDecision[];
  readonly evidence?: string;
  readonly outcomes?: string;
  readonly reflection?: string;
}

/** The fields shown before the decisions, by their fixed labels, in order. */
const BEFORE = [
  ['challenge', 'Challenge'],
  ['context', 'Context'],
  ['role', 'Role'],
  ['constraints', 'Constraints'],
] as const;

/** The fields shown after them. */
const AFTER = [
  ['outcomes', 'Outcomes'],
  ['reflection', 'Reflection'],
] as const;

function one(level: HeadingLevel): HeadingLevel {
  return Math.min(level + 1, 6) as HeadingLevel;
}

/** Markdown, or a list of short items, each Markdown inline. */
function Body({
  value,
  input,
}: {
  value: string | readonly string[] | undefined;
  input: VariantRenderInput;
}) {
  if (typeof value === 'string') {
    return present(value) ? <RichText source={value} input={input} /> : null;
  }
  const items = (value ?? []).filter(present);
  if (items.length === 0) return null;
  return (
    <ul className="pf-highlights">
      {items.map((item, index) => (
        <li key={index}>
          <RichText source={item} inline input={input} />
        </li>
      ))}
    </ul>
  );
}

/** Whether a field has anything the owner wrote. */
function authored(value: string | readonly string[] | undefined): boolean {
  return typeof value === 'string' ? present(value) : (value ?? []).some(present);
}

/** One field under its fixed label, or nothing when the owner didn't write it. */
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
  /** The work's title, the page's heading. */
  readonly title: string;
  readonly fields: CaseStudyFields;
  readonly ctx: RenderContext;
  /** The title's level: 1 on the work's own page. */
  readonly level?: HeadingLevel;
  /** What renders between the title and the fields, such as the cover. */
  readonly lead?: ReactNode;
  /** The work's evidence records, rendered, which show under Evidence after the owner's text. */
  readonly evidence?: ReactNode;
}

export function CaseStudy({ title, fields, ctx, level = 1, lead, evidence }: CaseStudyProps) {
  const { input } = ctx;
  const fieldLevel = one(level);
  const decisionLevel = one(fieldLevel);
  const decisions = (fields.decisions ?? []).filter(({ decision }) => present(decision));
  const hasEvidence = authored(fields.evidence) || evidence !== undefined;
  return (
    <article className="pf-case-study">
      <header className="pf-case-study__header">
        <p className="pf-case-study__label">
          <Ui ctx={ctx}>Case study</Ui>
        </p>
        <Heading level={level} className="pf-case-study__title">
          {title}
        </Heading>
      </header>
      {lead}
      {BEFORE.filter(([key]) => authored(fields[key])).map(([key, label]) => (
        <Field key={key} label={label} level={fieldLevel} ctx={ctx}>
          <Body value={fields[key]} input={input} />
        </Field>
      ))}
      {decisions.length > 0 ? (
        <Field label="Decisions" level={fieldLevel} ctx={ctx}>
          <ol className="pf-decisions">
            {decisions.map((decision, index) => (
              <li key={index} className="pf-decision">
                <RichText source={decision.decision} className="pf-decision__text" input={input} />
                {authored(decision.rationale) ? (
                  <>
                    <Heading level={decisionLevel} className="pf-decision__label">
                      <Ui ctx={ctx}>Rationale</Ui>
                    </Heading>
                    <Body value={decision.rationale} input={input} />
                  </>
                ) : null}
                {authored(decision.alternatives) ? (
                  <>
                    <Heading level={decisionLevel} className="pf-decision__label">
                      <Ui ctx={ctx}>Alternatives</Ui>
                    </Heading>
                    <Body value={decision.alternatives} input={input} />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </Field>
      ) : null}
      {hasEvidence ? (
        <Field label="Evidence" level={fieldLevel} ctx={ctx}>
          <Body value={fields.evidence} input={input} />
          {evidence}
        </Field>
      ) : null}
      {AFTER.filter(([key]) => authored(fields[key])).map(([key, label]) => (
        <Field key={key} label={label} level={fieldLevel} ctx={ctx}>
          <Body value={fields[key]} input={input} />
        </Field>
      ))}
    </article>
  );
}
