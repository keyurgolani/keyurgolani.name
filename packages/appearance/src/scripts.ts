// Which script a language tag is written in, and whether a typography
// profile covers it (#19, Slice 1, item 6, appearance.script-coverage).
// Intl.Locale's likely subtags give a tag's script, the way CLDR has it, in
// browsers and in Node alike.

/** Scripts that stand for others: a profile covers one when it covers every part. */
const PARTS: Readonly<Record<string, readonly string[]>> = {
  Jpan: ['Hani', 'Hira', 'Kana'],
  Kore: ['Hang', 'Hani'],
  Hans: ['Hani'],
  Hant: ['Hani'],
  Hrkt: ['Hira', 'Kana'],
};

/** Codes for no particular script, which any profile covers. */
const ANY_SCRIPT: ReadonlySet<string> = new Set([
  'Zinh',
  'Zmth',
  'Zsye',
  'Zsym',
  'Zxxx',
  'Zyyy',
  'Zzzz',
]);

/**
 * The ISO 15924 script `tag` is written in: its own script subtag, else the
 * language's likely one. Null when there's none to say, such as for und.
 */
export function scriptOf(tag: string): string | null {
  try {
    const locale = new Intl.Locale(tag);
    if (locale.script) return locale.script;
    if (locale.language === 'und') return null;
    return locale.maximize().script ?? null;
  } catch {
    return null;
  }
}

/** Whether a profile declaring `scripts` covers `script`. */
export function coversScript(scripts: readonly string[], script: string): boolean {
  if (ANY_SCRIPT.has(script) || scripts.includes(script)) return true;
  const parts = PARTS[script];
  return parts !== undefined && parts.every((part) => scripts.includes(part));
}
