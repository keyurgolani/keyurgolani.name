import type { ReactNode } from 'react';
import type { Period } from '@portfolio/schema';
import { hrefFor, pageOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { promptOf, type Command, type Prompt, type PromptStyle } from './model';

// The pieces every Shell frame and listing shares: the prompt line, the
// composition's own English words, dates and ranges, and links. Markup only.

/** `en` when the portfolio isn't English, for the words the composition adds. */
export function uiLangOf(input: Pick<VariantRenderInput, 'portfolio'>): 'en' | undefined {
  return /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';
}

/** The composition's own words, marked English in a portfolio that isn't. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Text only assistive tech reads. */
export function Sr({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span className="sh-sr" lang={lang}>
      {children}
    </span>
  );
}

/** Whether a URL leaves the site. */
export const external = (url: string) => /^https?:/i.test(url);

/** A link from the content, through hrefFor(), marked when it leaves the site. */
export function Link({
  url,
  input,
  className,
  children,
}: {
  url: string;
  input: VariantRenderInput;
  className?: string;
  children: ReactNode;
}) {
  const out = external(url);
  const cls = [className, out ? 'sh-ext' : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <a className={cls} href={hrefFor(url, input)}>
      {children}
    </a>
  );
}

/** A raw date as a time element, as written. */
export function When({ raw }: { raw: unknown }) {
  if (raw === undefined || raw === null || String(raw) === '') return null;
  const text = String(raw);
  return <time dateTime={text}>{text}</time>;
}

/** A period as git's range: `start..end`, with a hidden "to", or `start..` with "to present". */
export function Range({ period, lang }: { period: Period; lang: 'en' | undefined }) {
  return (
    <>
      <When raw={period.start} />
      <span aria-hidden="true">..</span>
      {period.end !== undefined ? (
        <>
          <Sr lang={lang}> to </Sr>
          <When raw={period.end} />
        </>
      ) : (
        <Sr lang={lang}> to present</Sr>
      )}
    </>
  );
}

/** The PS1 prompt: user@host, the directory, and `$`, as the owner's prompt control sets it. */
export function Ps1({ prompt, cwd, style }: { prompt: Prompt; cwd: string; style: PromptStyle }) {
  const who =
    style === 'full' && prompt.user ? `${prompt.user}${prompt.host ? `@${prompt.host}` : ''}` : '';
  return (
    <span className="sh-ps1">
      {who ? <span className="sh-ps1__who">{who} </span> : null}
      {style !== 'bare' ? <span className="sh-ps1__cwd">{cwd}</span> : null}
      {style !== 'bare' ? ' ' : null}
      <span className="sh-ps1__sig">$</span>
    </span>
  );
}

/** A command's arguments, its flags set apart. */
function Args({ args }: { args: string }) {
  return (
    <span className="sh-cmd__args">
      {args.split(' ').map((part, i) => (
        <span key={i} className={/^-{1,2}[\w=.]/.test(part) ? 'sh-cmd__flag' : undefined}>
          {i > 0 ? ' ' : ''}
          {part}
        </span>
      ))}
    </span>
  );
}

/** A prompt and its command as a run of text, for a line that isn't its own block (a fold's summary). */
export function CommandText({
  input,
  cwd,
  command,
  style,
}: {
  input: Pick<VariantRenderInput, 'portfolio' | 'controls'>;
  cwd: string;
  command: Command;
  style: PromptStyle;
}) {
  return (
    <>
      <Ps1 prompt={promptOf(input)} cwd={cwd} style={style} />{' '}
      <span className="sh-cmd__verb">{command.verb}</span>
      {command.args ? (
        <>
          {' '}
          <Args args={command.args} />
        </>
      ) : null}
    </>
  );
}

/** A prompt line with its command: shell idiom, so assistive tech never hears it. */
export function CommandLine({
  input,
  cwd,
  command,
  style,
}: {
  input: Pick<VariantRenderInput, 'portfolio' | 'controls'>;
  cwd: string;
  command: Command;
  style: PromptStyle;
}) {
  return (
    <p className="sh-cmd" aria-hidden="true">
      <CommandText input={input} cwd={cwd} command={command} style={style} />
    </p>
  );
}

const outlines = new WeakMap<object, ReturnType<typeof pageOutline>>();

/** Home's outline for this render, computed once: the hrefs every link and the index read. */
export function outlineFor(input: VariantRenderInput): ReturnType<typeof pageOutline> {
  let outline = outlines.get(input);
  if (!outline) {
    outline = pageOutline(input);
    outlines.set(input, outline);
  }
  return outline;
}

/** The href of a work's own page, when it has one. */
export function workHref(input: VariantRenderInput, id: string): string | undefined {
  return outlineFor(input).works.find((work) => work.id === id)?.href;
}
