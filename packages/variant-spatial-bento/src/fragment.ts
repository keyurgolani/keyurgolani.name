// A URL fragment's id, decoded. Anyone can send a link with a malformed
// escape (`/#%`, `/#100%`, a cut multibyte `/#%E0%A4%A`), and the URL keeps
// it as it is, so decoding it can throw. Every reader of a fragment goes
// through this, which answers null rather than throw.

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
