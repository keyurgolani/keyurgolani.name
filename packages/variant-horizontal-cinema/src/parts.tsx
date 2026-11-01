// What the composition's own pieces share: its own ids, and the language
// of the words it adds. Browser-safe, so the controller reads the same ids
// the server writes.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (prefix: string, name: string) => `${prefix}hc--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds, such as Index. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: string }) {
  // Isolated left to right as well, so in a right-to-left page its punctuation stays where it reads.
  return lang ? (
    <span lang={lang} dir="ltr">
      {children}
    </span>
  ) : (
    <>{children}</>
  );
}

/** The chapters' numerals, as the bars, the scrubber, and the credits set them. */
const NUMERALS = ['I', 'II', 'III', 'IV', 'V'] as const;
export const numeralOf = (chapter: number): string => NUMERALS[chapter] ?? String(chapter + 1);

/** The year a raw date names, `2022` from `2022-01`, or none. */
export function yearOf(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : /^(\d{4})/.exec(String(raw))?.[1];
}

/** A text's first sentence, and what follows it, so a scene can lead with its own words. */
export function firstSentence(text: string): { lead: string; rest?: string } {
  const match = /^([\s\S]+?[.!?])\s+([\s\S]+)$/.exec(text.trim());
  return match ? { lead: match[1]!, rest: match[2]!.trim() } : { lead: text.trim() };
}

/** What a scene is called, and whether those are the composition's own words. */
export interface TitleMark {
  readonly title: string;
  /** The title without the composition's ", continued", for a reel's later part. */
  readonly base: string;
  /** The whole title is the composition's word: Opening, Timeline, a chapter's name. */
  readonly own: boolean;
  /** A reel's later part, whose title ends in the composition's ", continued". */
  readonly continued: boolean;
}

/** A scene's title, its English words marked in a portfolio in another language. */
export function SceneTitle({ mark, lang }: { mark: TitleMark; lang: 'en' | undefined }) {
  if (mark.own) return <Words lang={lang}>{mark.title}</Words>;
  if (mark.continued) {
    return (
      <>
        {mark.base}
        <Words lang={lang}>, continued</Words>
      </>
    );
  }
  return <>{mark.title}</>;
}
