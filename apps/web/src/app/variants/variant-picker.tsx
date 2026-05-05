'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColorScheme, TypographyPreset } from '@portfolio/kit';
import { VariantCustomizer } from './variant-customizer';

export interface VariantSummary {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  author?: string;
  version: string;
  aesthetic: string;
  motion: string;
  density: string;
  typography: string;
  bestFor: string[];
  supportedKinds: string[];
  themes: string[];
  colorSchemes: ColorScheme[];
  typographyPresets: TypographyPreset[];
  experimental: boolean;
}

interface VariantPickerProps {
  activeSlug: string;
  variants: VariantSummary[];
  activeColorScheme: string | null;
  activeTypography: string | null;
}

const AESTHETIC_OPTIONS = ['editorial', 'spatial', 'kinetic', 'popart', 'terminal', 'bento', 'narrative', 'custom'];
const MOTION_OPTIONS = ['still', 'subtle', 'animated', 'kinetic'];
const TYPOGRAPHY_OPTIONS = ['serif', 'sans', 'mono', 'mixed'];
const DENSITY_OPTIONS = ['minimal', 'balanced', 'dense'];

export function VariantPicker({
  activeSlug,
  variants,
  activeColorScheme,
  activeTypography,
}: VariantPickerProps) {
  const [active, setActive] = useState(activeSlug);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [aesthetics, setAesthetics] = useState<Set<string>>(new Set());
  const [motions, setMotions] = useState<Set<string>>(new Set());
  const [typographies, setTypographies] = useState<Set<string>>(new Set());
  const [densities, setDensities] = useState<Set<string>>(new Set());
  const [requiredKinds, setRequiredKinds] = useState<Set<string>>(new Set());
  const [showMore, setShowMore] = useState(false);

  function toggle(set: Set<string>, value: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return variants.filter((v) => {
      if (q) {
        const hay =
          `${v.name} ${v.tagline ?? ''} ${v.description ?? ''} ${v.bestFor.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (aesthetics.size && !aesthetics.has(v.aesthetic)) return false;
      if (motions.size && !motions.has(v.motion)) return false;
      if (typographies.size && !typographies.has(v.typography)) return false;
      if (densities.size && !densities.has(v.density)) return false;
      if (requiredKinds.size) {
        for (const k of requiredKinds) {
          if (!v.supportedKinds.includes(k)) return false;
        }
      }
      return true;
    });
  }, [variants, search, aesthetics, motions, typographies, densities, requiredKinds]);

  async function activate(slug: string, scheme: string, typography: string) {
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/variant', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        ...(scheme ? { colorScheme: scheme } : {}),
        ...(typography ? { typography } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setActive(slug);
    setSuccess(`Activated ${slug}.`);
    startTransition(() => router.refresh());
  }

  const totalActiveFilters =
    aesthetics.size + motions.size + typographies.size + densities.size + requiredKinds.size;

  function clearAll() {
    setSearch('');
    setAesthetics(new Set());
    setMotions(new Set());
    setTypographies(new Set());
    setDensities(new Set());
    setRequiredKinds(new Set());
  }

  // Build the kinds set from the loaded variants for the advanced filter
  const allKinds = useMemo(() => {
    const set = new Set<string>();
    variants.forEach((v) => v.supportedKinds.forEach((k) => set.add(k)));
    return Array.from(set).sort();
  }, [variants]);

  return (
    <>
      {error ? <pre className="host-chrome__error">{error}</pre> : null}
      {success ? <p className="host-chrome__success">{success}</p> : null}

      <div className="variant-filters">
        <input
          type="search"
          placeholder="Search by name, description, or best-for tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="variant-filters__search"
        />

        <ChipRow
          label="Aesthetic"
          options={AESTHETIC_OPTIONS}
          selected={aesthetics}
          onToggle={(v) => toggle(aesthetics, v, setAesthetics)}
        />
        <ChipRow
          label="Motion"
          options={MOTION_OPTIONS}
          selected={motions}
          onToggle={(v) => toggle(motions, v, setMotions)}
        />
        <ChipRow
          label="Typography"
          options={TYPOGRAPHY_OPTIONS}
          selected={typographies}
          onToggle={(v) => toggle(typographies, v, setTypographies)}
        />
        <ChipRow
          label="Density"
          options={DENSITY_OPTIONS}
          selected={densities}
          onToggle={(v) => toggle(densities, v, setDensities)}
        />

        <button
          type="button"
          className="variant-filters__more-toggle"
          onClick={() => setShowMore((s) => !s)}
        >
          {showMore ? '− Hide advanced filters' : '+ More filters'}
        </button>

        {showMore ? (
          <ChipRow
            label="Must render"
            options={allKinds}
            selected={requiredKinds}
            onToggle={(v) => toggle(requiredKinds, v, setRequiredKinds)}
            title="Filter to variants that natively support these section kinds."
          />
        ) : null}

        {(totalActiveFilters > 0 || search) && (
          <div className="variant-filters__summary">
            <span>
              {filtered.length} of {variants.length} variants
            </span>
            <button type="button" onClick={clearAll} className="variant-filters__clear">
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="host-chrome__variant-grid">
        {filtered.map((v) => (
          <VariantCard
            key={v.slug}
            variant={v}
            isActive={v.slug === active}
            activeColorScheme={activeColorScheme}
            activeTypography={activeTypography}
            pending={pending}
            onActivate={activate}
          />
        ))}
        {filtered.length === 0 ? (
          <p style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#8a8780' }}>
            No variants match these filters. <button onClick={clearAll}>Clear all</button>
          </p>
        ) : null}
      </div>
    </>
  );
}

interface VariantCardProps {
  variant: VariantSummary;
  isActive: boolean;
  activeColorScheme: string | null;
  activeTypography: string | null;
  pending: boolean;
  onActivate: (slug: string, scheme: string, typography: string) => void;
}

function VariantCard({
  variant: v,
  isActive,
  activeColorScheme,
  activeTypography,
  pending,
  onActivate,
}: VariantCardProps) {
  // Default the picker to the active values when this is the live variant,
  // otherwise to the manifest's `default: true` entries (or the first one).
  // Preview-without-selection has no meaning — every variant has at least
  // one scheme + typography, even when only one is offered.
  const defaultScheme =
    v.colorSchemes.find((s) => s.default)?.id ?? v.colorSchemes[0]?.id ?? '';
  const defaultTypography =
    v.typographyPresets.find((p) => p.default)?.id ?? v.typographyPresets[0]?.id ?? '';

  // What the YAML-resolved active state of this card looks like — when
  // activeColorScheme/typography are unset on the active variant, that's
  // semantically the same as the variant's default.
  const effectiveActiveScheme = isActive ? activeColorScheme ?? defaultScheme : defaultScheme;
  const effectiveActiveTypography = isActive
    ? activeTypography ?? defaultTypography
    : defaultTypography;

  const [scheme, setScheme] = useState(effectiveActiveScheme);
  const [typography, setTypography] = useState(effectiveActiveTypography);

  const previewParams = new URLSearchParams();
  if (scheme) previewParams.set('scheme', scheme);
  if (typography) previewParams.set('typography', typography);
  const previewQuery = previewParams.toString();
  const previewHref = `/preview/${v.slug}${previewQuery ? `?${previewQuery}` : ''}`;

  // The card is "current" only when this is the active variant *and* the
  // picker matches what's already saved. Activating with a new combination
  // makes the active card non-current until you click Activate again.
  const isCurrent =
    isActive && scheme === effectiveActiveScheme && typography === effectiveActiveTypography;

  return (
    <article
      className="host-chrome__variant-card"
      data-active={isActive}
      data-current={isCurrent}
      data-experimental={v.experimental}
    >
      <div>
        <h3>
          {v.name}
          {v.experimental ? <span className="variant-card__exp"> · experimental</span> : null}
        </h3>
        <div className="meta">
          {v.author ? `${v.author} · ` : ''}v{v.version} · {v.supportedKinds.length} kinds
        </div>
      </div>
      {v.tagline ? <p>{v.tagline}</p> : null}

      <VariantCustomizer
        colorSchemes={v.colorSchemes}
        typographyPresets={v.typographyPresets}
        scheme={scheme}
        typography={typography}
        onSchemeChange={setScheme}
        onTypographyChange={setTypography}
        disabled={pending}
      />

      {v.description ? (
        <p style={{ fontSize: '0.875rem', color: '#8a8780' }}>{v.description}</p>
      ) : null}

      <div className="variant-card__attrs">
        <span className="variant-card__attr">{v.aesthetic}</span>
        <span className="variant-card__attr">{v.motion}</span>
        <span className="variant-card__attr">{v.typography}</span>
        <span className="variant-card__attr">{v.density}</span>
        {v.colorSchemes.length > 1 ? (
          <span className="variant-card__attr">{v.colorSchemes.length} schemes</span>
        ) : null}
        {v.typographyPresets.length > 1 ? (
          <span className="variant-card__attr">{v.typographyPresets.length} typesets</span>
        ) : null}
      </div>

      {v.bestFor.length ? (
        <div className="variant-card__bestfor">Best for: {v.bestFor.join(', ')}</div>
      ) : null}

      <div className="variant-card__actions">
        <button
          type="button"
          className={
            isCurrent
              ? 'host-chrome__button'
              : 'host-chrome__button host-chrome__button--primary'
          }
          disabled={isCurrent || pending}
          onClick={() => onActivate(v.slug, scheme, typography)}
        >
          {isCurrent ? 'Active' : 'Activate'}
        </button>
        <Link href={previewHref} className="host-chrome__button">
          Preview
        </Link>
      </div>
    </article>
  );
}

interface ChipRowProps {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  title?: string;
}

function ChipRow({ label, options, selected, onToggle, title }: ChipRowProps) {
  return (
    <div className="variant-filters__row" title={title}>
      <span className="variant-filters__label">{label}</span>
      <div className="variant-filters__chips">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            data-active={selected.has(opt)}
            onClick={() => onToggle(opt)}
            className="variant-filters__chip"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
