import type { Portfolio, Section } from '@portfolio/schema';

export interface FeedEntry {
  /** Stable identifier — URL when present, otherwise a slug from title+date. */
  id: string;
  title: string;
  url: string | null;
  publishedAt: string | null;
  /** ISO timestamp form of `publishedAt` for ordering. May be null. */
  isoDate: string | null;
  summary: string | null;
  category: 'writing' | 'publication' | 'episode';
  /** Source venue/publication/show — used as `<source>` in RSS. */
  venue: string | null;
}

export interface BuildFeedOptions {
  /** Cap on items returned. Default 50. */
  limit?: number;
}

/**
 * Collect feed-shaped entries from `writings`, `publications`, and `episodes`
 * sections. Sorts newest-first by `publishedAt`. Items without dates fall to
 * the bottom in stable order.
 */
export function collectFeedEntries(
  portfolio: Portfolio,
  options: BuildFeedOptions = {},
): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const section of portfolio.sections) {
    if (section.hidden) continue;
    pushFromSection(section, entries);
  }

  entries.sort((a, b) => {
    const ax = a.isoDate ? Date.parse(a.isoDate) : Number.NEGATIVE_INFINITY;
    const bx = b.isoDate ? Date.parse(b.isoDate) : Number.NEGATIVE_INFINITY;
    return bx - ax;
  });

  return options.limit !== undefined ? entries.slice(0, options.limit) : entries;
}

function pushFromSection(section: Section, out: FeedEntry[]): void {
  switch (section.kind) {
    case 'writings':
      for (const item of section.items) {
        out.push({
          id: item.url ?? `writings:${item.title}:${item.publishedAt ?? ''}`,
          title: item.title,
          url: item.url ?? null,
          publishedAt: item.publishedAt ?? null,
          isoDate: toIso(item.publishedAt),
          summary: item.summary ?? item.excerpt ?? null,
          category: 'writing',
          venue: item.publication ?? null,
        });
      }
      break;
    case 'publications':
      for (const item of section.items) {
        out.push({
          id: item.url ?? item.doi ?? `publications:${item.title}:${item.publishedAt ?? ''}`,
          title: item.title,
          url: item.url ?? item.pdfUrl ?? null,
          publishedAt: item.publishedAt ?? null,
          isoDate: toIso(item.publishedAt),
          summary: item.abstract ?? null,
          category: 'publication',
          venue: item.venue ?? null,
        });
      }
      break;
    case 'episodes':
      for (const item of section.items) {
        out.push({
          id: item.audioUrl ?? `episodes:${item.title}:${item.publishedAt ?? ''}`,
          title: item.number ? `Ep ${item.number}: ${item.title}` : item.title,
          url: item.audioUrl ?? item.videoUrl ?? null,
          publishedAt: item.publishedAt ?? null,
          isoDate: toIso(item.publishedAt),
          summary: item.description ?? null,
          category: 'episode',
          venue: section.showName ?? null,
        });
      }
      break;
    default:
      break;
  }
}

function toIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^(?:present|now|current)$/i.test(trimmed)) return new Date().toISOString();

  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  if (iso) {
    const y = iso[1];
    const m = (iso[2] ?? '01').padStart(2, '0');
    const d = (iso[3] ?? '01').padStart(2, '0');
    const candidate = new Date(`${y}-${m}-${d}T00:00:00Z`);
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }

  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (monthYear) {
    const candidate = new Date(`1 ${monthYear[1]} ${monthYear[2]} UTC`);
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }

  const native = new Date(trimmed);
  if (!Number.isNaN(native.getTime())) return native.toISOString();
  return null;
}

export interface RenderRssOptions {
  /** Optional override for the `<link>` element. Defaults to portfolio.meta.url. */
  siteUrl?: string;
  /** Override for `<atom:link rel="self">`. Defaults to siteUrl + '/feed.xml'. */
  feedUrl?: string;
  /** Cap on items returned. Default 50. */
  limit?: number;
}

/**
 * Produce an RSS 2.0 feed (with the Atom self-link extension) from the
 * portfolio's writings/publications/episodes. Returns the XML as a string;
 * callers wrap it in a `Response` with `application/rss+xml`.
 */
export function renderRssFeed(portfolio: Portfolio, options: RenderRssOptions = {}): string {
  const site = options.siteUrl ?? portfolio.meta?.url ?? '';
  const feed = options.feedUrl ?? (site ? `${site.replace(/\/$/, '')}/feed.xml` : '');
  const title = portfolio.meta?.title ?? `${portfolio.identity.name} — Portfolio`;
  const description =
    portfolio.meta?.description ?? portfolio.identity.tagline ?? `Updates from ${portfolio.identity.name}.`;

  const entries = collectFeedEntries(portfolio, { limit: options.limit ?? 50 });
  const items = entries.map(renderItem).join('\n');
  const lastBuildDate = entries[0]?.isoDate
    ? new Date(entries[0].isoDate).toUTCString()
    : new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(site)}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(portfolio.meta?.title ? 'en' : 'en')}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    ${feed ? `<atom:link href="${escapeXml(feed)}" rel="self" type="application/rss+xml" />` : ''}
${items}
  </channel>
</rss>
`;
}

function renderItem(entry: FeedEntry): string {
  const pubDate = entry.isoDate ? new Date(entry.isoDate).toUTCString() : null;
  const link = entry.url ? `<link>${escapeXml(entry.url)}</link>` : '';
  const guid = `<guid isPermaLink="${entry.url ? 'true' : 'false'}">${escapeXml(entry.id)}</guid>`;
  const description = entry.summary ? `<description>${escapeXml(entry.summary)}</description>` : '';
  const category = `<category>${escapeXml(entry.category)}</category>`;
  const source = entry.venue ? `<source>${escapeXml(entry.venue)}</source>` : '';
  const dateTag = pubDate ? `<pubDate>${pubDate}</pubDate>` : '';

  return [
    '    <item>',
    `      <title>${escapeXml(entry.title)}</title>`,
    link ? `      ${link}` : '',
    `      ${guid}`,
    description ? `      ${description}` : '',
    `      ${category}`,
    source ? `      ${source}` : '',
    dateTag ? `      ${dateTag}` : '',
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
