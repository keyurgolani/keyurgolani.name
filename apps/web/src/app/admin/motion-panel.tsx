'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MotionPreference } from '@portfolio/kit';

interface MotionPanelProps {
  activeMotionPreference: MotionPreference;
}

const OPTIONS: Array<{ value: MotionPreference; label: string; description: string }> = [
  { value: 'respect-os', label: 'Respect OS', description: 'Follow the visitor’s prefers-reduced-motion.' },
  { value: 'full', label: 'Full motion', description: 'Animate regardless of OS preference.' },
  { value: 'reduce', label: 'Reduce motion', description: 'Force reduced motion always.' },
];

export function MotionPanel({ activeMotionPreference }: MotionPanelProps) {
  const [motion, setMotion] = useState<MotionPreference>(activeMotionPreference);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty = motion !== activeMotionPreference;

  async function apply() {
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/customize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motionPreference: motion }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setSuccess('Saved.');
    startTransition(() => router.refresh());
  }

  return (
    <section className="customize-panel">
      <h2>Motion preference</h2>
      <p className="customize-panel__hint">
        Variant-agnostic. Color scheme and typography are configured per-variant on{' '}
        <a href="/variants">/variants</a>.
      </p>
      <div className="customize-panel__field">
        <label>
          <span className="customize-panel__label">Motion</span>
          <select value={motion} disabled={pending} onChange={(e) => setMotion(e.target.value as MotionPreference)}>
            {OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <p className="customize-panel__description">
          {OPTIONS.find((o) => o.value === motion)?.description}
        </p>
      </div>
      {error ? <pre className="host-chrome__error">{error}</pre> : null}
      {success ? <p className="host-chrome__success">{success}</p> : null}
      <div className="customize-panel__actions">
        <button
          type="button"
          className="host-chrome__button host-chrome__button--primary"
          onClick={apply}
          disabled={!dirty || pending}
        >
          {pending ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </section>
  );
}
