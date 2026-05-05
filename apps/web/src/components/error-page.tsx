import Link from 'next/link';

interface ErrorPageProps {
  title: string;
  message: string;
}

export function ErrorPage({ title, message }: ErrorPageProps) {
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
