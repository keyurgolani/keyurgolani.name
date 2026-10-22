import Link from 'next/link';

// A Studio page that calls notFound(), inside Studio's layout. Like Studio's
// other boundaries it is markup only (routes.test.ts): what it renders goes
// out with every Studio page, a redirect to sign-in included, so it reads
// nothing, and links home as Studio's error page does.
export default function StudioNotFound() {
  return (
    <main className="host-chrome">
      <h1>Page not found</h1>
      <p>Nothing lives at this address.</p>
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
