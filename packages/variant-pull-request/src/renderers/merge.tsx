import type { ReactNode } from 'react';
import {
  hrefFor,
  present,
  sameTarget,
  type FooterLink,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Stat } from '../diff';
import { external, reviewOf, Sr, Tick, uiLangOf, Words, type Review } from '../parts';

// The merge box (issue #270, behaviour 6): Contact. It says the change is
// ready, draws the branch beside main, sums the checks and the files, and
// leads with Approve and merge, a real link to where the owner is best
// reached (the model's mergeTargetOf). The enhancement then shows the change
// as merged: the branch joins main, the state reads Merged. The contact's
// message, its address, and every other way in follow.

/** The head branch, its commits as dots, beside main; merged, it joins main. Decoration with a name. */
export function Branch({ review }: { review: Review }) {
  const dots = Math.min(Math.max(review.commits, 1), 10);
  return (
    <svg
      className="pr-branch"
      viewBox="0 0 260 74"
      role="img"
      aria-label={`${review.head} beside ${review.base}`}
    >
      <path className="pr-branch__main" d="M4 56 H256" />
      <path className="pr-branch__head" d="M18 56 C30 56 30 22 44 22 H214" />
      <path className="pr-branch__join" d="M214 22 C228 22 228 56 242 56" pathLength={1} />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} className="pr-branch__c" cx={(56 + i * 15).toFixed(1)} cy="22" r="3.2" />
      ))}
      <circle className="pr-branch__m" cx="242" cy="56" r="5" />
    </svg>
  );
}

/** A link out, opening another tab when it leaves the site. */
function Out({
  link,
  className,
  merge,
  lang,
  children,
}: {
  link: FooterLink;
  className?: string;
  merge?: boolean;
  lang: 'en' | undefined;
  children: ReactNode;
}) {
  const leaves = external(link.href);
  return (
    <a
      className={className}
      href={link.href}
      {...(leaves ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...(merge ? { 'data-pr-merge': '' } : {})}
    >
      {children}
      {leaves ? <Sr lang={lang}> (opens in a new tab)</Sr> : null}
    </a>
  );
}

/** The merge box's body: its state, the branch, the summary, Approve and merge, and the ways in. */
export function MergeBody({
  input,
  message,
  links,
}: {
  input: VariantRenderInput;
  message?: string;
  links: readonly FooterLink[];
}) {
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  const target = review.merge;
  const email = review.footer.email;
  const others = links.filter(
    (link) =>
      !(target && sameTarget(link.href, target.href)) &&
      !(email && sameTarget(link.href, email.href)),
  );
  return (
    <>
      <p className="pr-merge__state" data-type-role="title">
        <span data-pr-merge-state="" lang={lang}>
          Ready to merge
        </span>
      </p>
      <Branch review={review} />
      <ul className="pr-merge__sum" role="list">
        {review.checks > 0 ? (
          <li>
            <Tick />
            <Words lang={lang}>
              {review.checks === 1 ? '1 check passed' : `All ${review.checks} checks passed`}
            </Words>
          </li>
        ) : null}
        {review.files.length > 0 ? (
          <li>
            <Tick />
            <span>
              {review.files.length}{' '}
              <Words lang={lang}>{review.files.length === 1 ? 'file' : 'files'}</Words>,{' '}
              <Stat adds={review.stat.adds} dels={review.stat.dels} lang={lang} />
            </span>
          </li>
        ) : null}
        <li>
          <span className="pr-ring" aria-hidden="true" />
          <span data-pr-merge-review="" lang={lang}>
            Waiting on your review
          </span>
        </li>
      </ul>
      {target ? (
        <p className="pr-merge__go">
          <Out link={target} className="pr-btn pr-btn--merge" merge lang={lang}>
            <Words lang={lang}>Approve and merge</Words>
          </Out>
          <span className="pr-merge__via">
            <span aria-hidden="true">{'→'} </span>
            {target.text}
          </span>
        </p>
      ) : null}
      {present(message) ? <p className="pr-merge__msg">{message}</p> : null}
      {email && target?.text !== email.text ? (
        <p className="pr-merge__mail">
          <a href={email.href}>{email.text}</a>
        </p>
      ) : null}
      {others.length > 0 ? (
        <>
          <p className="pr-merge__oh">
            <Words lang={lang}>Other ways in</Words>
          </p>
          <ul className="pr-merge__o" role="list">
            {others.map((link) => (
              <li key={link.href}>
                <Out link={link} lang={lang}>
                  {link.text}
                </Out>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** Contact: the merge box, its message and links the contact record's, else the portfolio's. */
export const Contact: SectionRenderer<SectionOf<'contact'>> = ({ input }) => {
  const review = reviewOf(input);
  const { footer } = review;
  const contactLinks = footer.contact?.links ?? [];
  const links = [
    ...contactLinks,
    ...footer.links.filter(
      (link) => !contactLinks.some((each) => sameTarget(each.href, link.href)),
    ),
  ];
  return <MergeBody input={input} message={footer.contact?.message} links={links} />;
};

/** A call to action: its description and its actions, the primary one leading. */
export const Cta: SectionRenderer<SectionOf<'cta'>> = ({ section, input }) => {
  const lang = uiLangOf(input);
  const actions = [section.primaryAction, section.secondaryAction].filter(
    (action): action is NonNullable<typeof action> => action !== undefined,
  );
  return (
    <>
      {present(section.description) ? <p className="pr-merge__msg">{section.description}</p> : null}
      {actions.length > 0 ? (
        <ul className="pr-desc__links" role="list">
          {actions.map((action, i) => (
            <li key={i}>
              <Out
                link={{ text: action.label, href: hrefFor(action.url, input) }}
                className={i === 0 ? 'pr-btn' : 'pr-btn pr-btn--quiet'}
                lang={lang}
              >
                {action.label}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};
