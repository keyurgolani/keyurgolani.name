import { NotFoundBody } from '../_chrome/not-found-body';

// A Studio page that calls notFound(), inside Studio's layout: the same
// generic 404 as the site's.
export default function StudioNotFound() {
  return <NotFoundBody />;
}
