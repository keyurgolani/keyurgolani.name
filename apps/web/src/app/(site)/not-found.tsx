import { NotFoundBody } from '../_chrome/not-found-body';

// A page of the site that calls notFound(), inside the site's layout. A URL
// no route matches gets global-not-found.tsx instead.
export default async function NotFound() {
  return NotFoundBody();
}
