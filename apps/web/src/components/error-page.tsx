import Link from 'next/link';
import { authoringRoutesEnabled } from '~/lib/authoring';

interface ErrorPageProps {
  title: string;
  message: string;
}

/**
 * Under `next dev` this shows the error text and links to the authoring
 * routes. A production build hides those routes and must not echo error
 * text (a parse error can quote the portfolio file), so it renders a fixed
 * heading and a link home. Callers log the underlying error themselves.
 */
export function ErrorPage({ title, message }: ErrorPageProps) {
  if (!authoringRoutesEnabled()) {
    return (
      <div className="host-chrome">
        <h1>This page could not be loaded</h1>
        <p>
          <Link href="/">Back to the home page</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="host-chrome">
      <nav className="host-chrome__nav">
        <Link href="/">Home</Link>
        <Link href="/admin">Admin</Link>
        <Link href="/variants">Variants</Link>
      </nav>
      <h1>{title}</h1>
      <pre className="host-chrome__error">{message}</pre>
      <p>
        Edit your portfolio at <Link href="/admin">/admin</Link> or pick a variant at{' '}
        <Link href="/variants">/variants</Link>.
      </p>
    </div>
  );
}
