import { headers } from 'next/headers';
import { EXPERIENCE_HEADER } from '~/server/route-header';
import { NotFoundBody } from '../_chrome/not-found-body';

// A page of the site that calls notFound(), inside the site's layout. A URL
// no route matches gets global-not-found.tsx instead. It renders in the
// composition of the experience segment proxy.ts named for the request (#6,
// Slice 2), since every page's payload carries it.
export default async function NotFound() {
  return NotFoundBody({ segment: (await headers()).get(EXPERIENCE_HEADER) ?? undefined });
}
