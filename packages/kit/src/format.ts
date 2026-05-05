import type { Period } from '@portfolio/schema';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

interface ParsedDate {
  year: number;
  month?: number;
  day?: number;
  isPresent?: boolean;
}

const MONTH_LOOKUP = new Map<string, number>();
MONTHS.forEach((m, i) => MONTH_LOOKUP.set(m.toLowerCase(), i));
SHORT_MONTHS.forEach((m, i) => MONTH_LOOKUP.set(m.toLowerCase(), i));

export function parseLooseDate(raw: string | undefined | null): ParsedDate | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'present' || lower === 'now' || lower === 'current') {
    return { year: new Date().getFullYear(), isPresent: true };
  }

  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: iso[2] ? Number(iso[2]) - 1 : undefined,
      day: iso[3] ? Number(iso[3]) : undefined,
    };
  }

  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (monthYear) {
    const m = MONTH_LOOKUP.get(monthYear[1]!.toLowerCase());
    return { year: Number(monthYear[2]), month: m };
  }

  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) return { year: Number(yearOnly[1]) };

  const native = new Date(trimmed);
  if (!Number.isNaN(native.getTime())) {
    return {
      year: native.getFullYear(),
      month: native.getMonth(),
      day: native.getDate(),
    };
  }

  return null;
}

export function formatDate(raw: string | undefined | null, opts: { short?: boolean } = {}): string {
  const parsed = parseLooseDate(raw);
  if (!parsed) return raw ?? '';
  if (parsed.isPresent) return 'Present';
  const months = opts.short ? SHORT_MONTHS : MONTHS;
  if (parsed.month != null) {
    const month = months[parsed.month] ?? '';
    return parsed.day != null ? `${month} ${parsed.day}, ${parsed.year}` : `${month} ${parsed.year}`;
  }
  return String(parsed.year);
}

export function formatYear(raw: string | undefined | null): string {
  const parsed = parseLooseDate(raw);
  if (!parsed) return raw ?? '';
  return parsed.isPresent ? 'Present' : String(parsed.year);
}

export function formatPeriod(period: Period | undefined, opts: { short?: boolean } = {}): string {
  if (!period) return '';
  const start = formatDate(period.start, opts);
  const end = period.end ? formatDate(period.end, opts) : 'Present';
  if (!start) return end;
  if (start === end) return start;
  return `${start} — ${end}`;
}

export function formatDuration(period: Period | undefined): string {
  if (!period) return '';
  const start = parseLooseDate(period.start);
  const endRaw = period.end ?? 'present';
  const end = parseLooseDate(endRaw);
  if (!start || !end) return '';
  const sm = start.month ?? 0;
  const em = end.month ?? 0;
  let months = (end.year - start.year) * 12 + (em - sm);
  if (months < 0) months = 0;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  if (yrs && mos) return `${yrs} yr${yrs > 1 ? 's' : ''} ${mos} mo${mos > 1 ? 's' : ''}`;
  if (yrs) return `${yrs} yr${yrs > 1 ? 's' : ''}`;
  if (mos) return `${mos} mo${mos > 1 ? 's' : ''}`;
  return 'Less than a month';
}

export function formatList(items: string[] | undefined, conjunction = 'and'): string {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

export function formatTrackDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatEpisodeDuration(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ensureSectionId(idOrTitle: string | undefined, fallback: string): string {
  if (idOrTitle) {
    const s = slugify(idOrTitle);
    if (s) return s;
  }
  return slugify(fallback) || fallback;
}

/**
 * Render a stat value (which may be `string | number`) consistently. Numbers
 * are localized; strings are passed through verbatim so authors can carry
 * their own formatting (e.g. `"10B+"`, `"~3min"`).
 */
export function formatStatValue(value: string | number): string {
  return typeof value === 'number' ? value.toLocaleString() : value;
}

/**
 * Compact human-friendly count (1.2K, 3.4M). Useful for star counts and
 * contribution numbers in dense layouts.
 */
export function formatCompactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (Math.abs(n) >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return String(n);
}

/**
 * Terse relative-time string. Buckets: "just now", "Xm/h/d/w/mo/y ago".
 * Variants render this for last-pushed-at on lists where compactness matters.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return '';
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  if (days < 56) return `${Math.round(days / 7)}w ago`;
  if (days < 547) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
