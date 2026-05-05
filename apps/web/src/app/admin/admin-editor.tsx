'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface AdminEditorProps {
  initialSource: string;
}

export function AdminEditor({ initialSource }: AdminEditorProps) {
  const [source, setSource] = useState(initialSource);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty = source !== initialSource;

  async function save() {
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: source,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setSuccess('Saved.');
    startTransition(() => router.refresh());
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <textarea
        className="host-chrome__textarea"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
      />
      {error ? <pre className="host-chrome__error">{error}</pre> : null}
      {success ? <p className="host-chrome__success">{success}</p> : null}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
        <button
          type="submit"
          className="host-chrome__button host-chrome__button--primary"
          disabled={!dirty || pending}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="host-chrome__button"
          onClick={() => {
            setSource(initialSource);
            setError(null);
            setSuccess(null);
          }}
          disabled={!dirty || pending}
        >
          Discard changes
        </button>
      </div>
    </form>
  );
}
