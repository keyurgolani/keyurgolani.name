/**
 * Generalized keyword-rule classifier. Pure function; the caller supplies
 * the rule set (keeps domain-specific taxonomies out of the kit).
 *
 * Variants use this to bucket timeline events by inferred kind without
 * each having to re-implement the priority-walk + regex test loop.
 */

export type ClassifyRules<K extends string> = {
  /**
   * Insertion order matters. The first kind whose patterns match wins. Use
   * this to encode priority — put the more specific kinds first (`internship`
   * before `job`).
   */
  [K_ in K]?: readonly RegExp[];
};

export interface ClassifyOptions<K extends string> {
  /** Returned when no rule matches. */
  fallback: K;
}

/**
 * Test the haystack against each kind's patterns in iteration order. The
 * first kind whose patterns include a match wins; if none match, returns
 * `options.fallback`.
 *
 *   const rules = {
 *     internship: [/intern(ship)?/i],
 *     research: [/\b(research|paper|publication|ieee)\b/i],
 *     project: [/\b(open[- ]?source|project|github)\b/i],
 *   };
 *   inferKindFromText('Senior Research Engineer', rules, { fallback: 'job' });
 *   // → 'research'
 */
export function inferKindFromText<K extends string>(
  haystack: string,
  rules: ClassifyRules<K>,
  options: ClassifyOptions<K>,
): K {
  const text = haystack.toLowerCase();
  for (const kind in rules) {
    const patterns = rules[kind];
    if (!patterns || patterns.length === 0) continue;
    for (const re of patterns) {
      if (re.test(text)) return kind as K;
    }
  }
  return options.fallback;
}
