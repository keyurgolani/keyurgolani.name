// Which way a language's text runs (#5): for the kit, a section whose `lang`
// differs from the portfolio's locale, and for the variant contract, content
// that runs right to left in a variant that declares only `ltr`. A fixed
// table, since Intl.Locale#getTextInfo isn't in every runtime the renderers
// run in, and the markup must be the same in all of them.

/** ISO 15924 scripts written right to left, lowercased. */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  'adlm',
  'arab',
  'aran',
  'armi',
  'avst',
  'chrs',
  'cprt',
  'elym',
  'hatr',
  'hebr',
  'hung',
  'khar',
  'lydi',
  'mand',
  'mani',
  'mend',
  'merc',
  'mero',
  'narb',
  'nbat',
  'nkoo',
  'orkh',
  'ougr',
  'palm',
  'phli',
  'phlp',
  'phnx',
  'prti',
  'rohg',
  'samr',
  'sarb',
  'sogd',
  'sogo',
  'syrc',
  'thaa',
  'yezi',
]);

/** Languages whose usual script runs right to left, when the tag names no script. */
const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'arc',
  'bal',
  'bqi',
  'ckb',
  'dv',
  'fa',
  'glk',
  'he',
  'iw',
  'ji',
  'khw',
  'ks',
  'lrc',
  'luz',
  'mzn',
  'nqo',
  'pnb',
  'prs',
  'ps',
  'sd',
  'sdh',
  'skr',
  'syr',
  'ug',
  'ur',
  'yi',
]);

/**
 * `rtl` or `ltr` for a BCP 47 tag: its script subtag decides when it has one,
 * so `sd-Deva` runs left to right, and otherwise its language does.
 */
export function languageDirection(tag: string): 'ltr' | 'rtl' {
  const [language = '', ...subtags] = tag.toLowerCase().split(/[-_]/);
  const script = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (script !== undefined) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}
