import { PREVIEW_UNAVAILABLE_TEXT } from '~/preview/status';

// What a frame shows when its page calls notFound(): a grant that ended in
// the moment since proxy.ts checked it, or a route the grant's variant
// doesn't declare. The status document's own words, with no link, so the
// frame never leaves its grant.
export default function PreviewNotFound() {
  return (
    <main>
      <p>{PREVIEW_UNAVAILABLE_TEXT}</p>
    </main>
  );
}
