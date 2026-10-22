import type { Evidence, PublicView, Work } from '@portfolio/schema';

export interface FeedEntry {
  /** The record's id, which its GUID is made from (#10). */
  id: string;
  title: string;
  url: string | null;
  publishedAt: string | null;
  /** ISO timestamp form of `publishedAt` for ordering. May be null. */
  isoDate: string | null;
  summary: string | null;
  category: 'writing' | 'publication' | 'episode';
  /** Source venue/publication/show, used as `<source>` in RSS. */
  venue: string | null;
}

export interface BuildFeedOptions {
  /** Cap on items returned. Default 50. */
  limit?: number;
}

/** What the feed reads: the published view's portfolio. */
export type FeedSource = Pick<PublicView, 'portfolio'>;

/** Which works the feed carries, and as what. */
const WORK_CATEGORIES: Readonly<Record<string, FeedEntry['category']>> = {
  writing: 'writing',
  'audio-video': 'episode',
};

function workEntry(work: Work, category: FeedEntry['category']): FeedEntry {
  const publishedAt = work.publishedAt ?? work.releasedAt ?? null;
  return {
    id: work.id,
    title: work.title,
    url: work.url ?? work.audioUrl ?? work.videoUrl ?? null,
    publishedAt,
    isoDate: toIso(publishedAt),
    summary: work.summary ?? work.excerpt ?? work.description ?? null,
    category,
    venue: work.publication ?? work.series ?? null,
  };
}

function publicationEntry(evidence: Evidence): FeedEntry | null {
  const title = evidence.title ?? evidence.statement;
  if (title === undefined) return null;
  const publishedAt = evidence.publishedAt ?? null;
  return {
    id: evidence.id,
    title,
    url: evidence.url ?? evidence.pdfUrl ?? null,
    publishedAt,
    isoDate: toIso(publishedAt),
    summary:
      evidence.abstract ?? (evidence.title !== undefined ? evidence.statement : undefined) ?? null,
    category: 'publication',
    venue: evidence.venue ?? null,
  };
}

/**
 * Collect feed entries from the published view's records: works of the
 * writing and audio-video media, and publication evidence. The view holds
 * only public records something visible reaches, so nothing hidden or
 * private reaches the feed. Sorts newest-first by `publishedAt`; entries
 * without dates fall to the bottom in document order.
 */
export function collectFeedEntries(view: FeedSource, options: BuildFeedOptions = {}): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const work of view.portfolio.works) {
    const category = WORK_CATEGORIES[work.medium];
    if (category) entries.push(workEntry(work, category));
  }
  for (const evidence of view.portfolio.evidence) {
    if (evidence.type !== 'publication') continue;
    const entry = publicationEntry(evidence);
    if (entry) entries.push(entry);
  }

  entries.sort((a, b) => {
    const ax = a.isoDate ? Date.parse(a.isoDate) : Number.NEGATIVE_INFINITY;
    const bx = b.isoDate ? Date.parse(b.isoDate) : Number.NEGATIVE_INFINITY;
    return bx === ax ? 0 : bx > ax ? 1 : -1;
  });

  return options.limit !== undefined ? entries.slice(0, options.limit) : entries;
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
  /** The site's canonical origin, for `<link>`, from the deployment. */
  siteUrl?: string;
  /** Override for `<atom:link rel="self">`. Defaults to siteUrl + '/feed.xml'. */
  feedUrl?: string;
  /** Cap on items returned. Default 50. */
  limit?: number;
}

/**
 * Produce an RSS 2.0 feed (with the Atom self-link extension) from the
 * published view's writing and audio-video works and its publications.
 * Returns the XML as a string; callers wrap it in a `Response` with
 * `application/rss+xml`. It takes the published view only, so nothing hidden
 * or private reaches the feed, and the channel's `<language>` is the
 * portfolio's locale. Each item's GUID is made from its record's id.
 */
export function renderRssFeed(view: FeedSource, options: RenderRssOptions = {}): string {
  const { portfolio } = view;
  const site = options.siteUrl ?? '';
  const feed = options.feedUrl ?? (site ? `${site.replace(/\/$/, '')}/feed.xml` : '');
  const title = portfolio.meta?.title ?? `${portfolio.identity.name} — Portfolio`;
  const description =
    portfolio.meta?.description ??
    portfolio.identity.tagline ??
    `Updates from ${portfolio.identity.name}.`;

  const entries = collectFeedEntries(view, { limit: options.limit ?? 50 });
  const items = entries.map((entry) => renderItem(entry, site)).join('\n');
  const lastBuildDate = entries[0]?.isoDate
    ? new Date(entries[0].isoDate).toUTCString()
    : new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(site)}</link>
    <description>${escapeXml(description)}</description>
    <language>${escapeXml(portfolio.locale)}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    ${feed ? `<atom:link href="${escapeXml(feed)}" rel="self" type="application/rss+xml" />` : ''}
${items}
  </channel>
</rss>
`;
}

/**
 * An item's GUID: its record's id, under the site's canonical origin when
 * there is one, so it stays the same for as long as the record does.
 */
export function feedGuid(id: string, siteUrl: string): string {
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}/#${id}` : id;
}

function renderItem(entry: FeedEntry, site: string): string {
  const pubDate = entry.isoDate ? new Date(entry.isoDate).toUTCString() : null;
  const link = entry.url ? `<link>${escapeXml(entry.url)}</link>` : '';
  const guid = `<guid isPermaLink="false">${escapeXml(feedGuid(entry.id, site))}</guid>`;
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
