import { servedPage } from '~/server/page-guard';
import { safeReturnTo, signInStateOf } from '~/server/return-to';
import { PruneJournal } from '../../_components/prune-journal';
import { SignInForm } from '../../_components/sign-in-form';

// /studio/sign-in (#2), outside the Studio shell, under owner only: the
// route table gives it auth.session, which only owner has, so demo and
// read-only answer the unknown-route 404. It renders the state its URL names
// before any script runs, and keeps where the owner was going in the form's
// own returnTo field.

export const metadata = { title: 'Sign in · Portfolio Studio' };

type Query = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : null;

/** Whole seconds left on a rate limit, as auth.login's redirect gives them. */
function seconds(value: string | null): number | null {
  return value !== null && /^\d{1,4}$/.test(value) ? Number(value) : null;
}

async function SignIn({ searchParams }: { searchParams: Query }) {
  const query = await searchParams;
  const state = signInStateOf(one(query.state));
  return (
    <main className="studio-sign-in">
      <h1 className="studio-sign-in__title">Portfolio Studio</h1>
      <p className="studio-sign-in__lede">Sign in with the owner password.</p>
      <SignInForm
        state={state}
        returnTo={safeReturnTo(one(query.returnTo))}
        retryAfter={state === 'rate_limited' ? seconds(one(query.retryAfter)) : null}
      />
      <PruneJournal />
    </main>
  );
}

export default servedPage('/studio/sign-in', SignIn);
