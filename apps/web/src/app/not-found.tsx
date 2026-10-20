import Link from 'next/link';

// Every profile serves the home page, so it is the one link here.
export default function NotFound() {
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
