// A URL fragment's id, decoded. Anyone can send a link with a malformed
// escape (`/#%`, `/#100%`, a cut multibyte `/#%E0%A4`), and the URL keeps it
// as it is, so decoding it can throw, and a throw on arrival would leave the
// page without any of Position's behaviour. Every reader of a fragment goes
// through this, which answers null rather than throw (Spatial Bento's
// fragment.ts does the same).

/** The id a fragment (`#…`, or a bare id) names, decoded; null when it's empty or won't decode. */
export function fragmentId(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
