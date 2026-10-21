import { servedPage } from '~/server/page-guard';
import { requireOwnerPage } from '~/server/studio-guard';
import { SignedIn } from '../_components/signed-in';

// /studio (#2): the placeholder #8 replaces with the Studio shell. Under
// owner only, with a session: requireOwnerPage sends a request without one
// to sign-in before anything renders.

export const metadata = { title: 'Portfolio Studio' };

async function Studio() {
  const { csrfToken } = await requireOwnerPage('studio.view');
  return (
    <main className="studio-sign-in">
      <h1 className="studio-sign-in__title">Portfolio Studio</h1>
      <p className="studio-status">Signed in</p>
      <SignedIn csrfToken={csrfToken} />
    </main>
  );
}

export default servedPage('/studio', Studio);
