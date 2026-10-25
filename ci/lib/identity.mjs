// The identity rows (#12, slice 3 item 7): what a server publishes about
// whose site it is. Under owner and read-only, the name, the canonical link,
// og:url, the Open Graph image, the sitemap, the robots host, the feed, and
// the JSON-LD follow the mounted identity and the origin the server was
// given, and never name the bundled sample's persona, example.com, the
// build host, or a container path. Given a `title`, the page's titles
// carry it. The Open Graph image is the card the server draws from
// identity.name on the origin; meta.ogImage isn't rendered yet, so its
// picture is held to the identity in the guide's config (fresh-clone's
// sampleLeftovers), not here. Under demo the site is the sample's
// alone: its persona, on the demo origin, out of search.
//
// Only what the server derives from the identity and the origin is held to
// it. Links the content itself names, such as a work's external URL in the
// feed or a profile in JSON-LD's sameAs, are the author's, and stay out of
// these checks. Pure Node, used by ci/rehearsal.mjs on the image and
// ci/fresh-clone.mjs on the guide's servers.

/** Strings no identity field may hold, whatever the profile: hosts and paths of the build, never the site's. */
export const BUILD_LEAKS = Object.freeze([
  'example.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '/app/',
  '/var/lib/portfolio',
  '/run/secrets',
  'file:',
]);

const decode = (text) =>
  String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The attributes of each `<tag ...>` in `html`, as maps. */
function tags(html, tag) {
  return [...String(html).matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [
        key.toLowerCase(),
        decode(value),
      ]),
    ),
  );
}

/** What a page's head says about whose site it is. */
export function pageIdentity(html) {
  const metas = tags(html, 'meta');
  const meta = (key) =>
    metas.filter((m) => m.property === key || m.name === key).map((m) => m.content ?? '');
  const jsonLd = [
    ...String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return { unreadable: m[1].slice(0, 200) };
    }
  });
  return {
    title: decode(/<title>([^<]*)<\/title>/i.exec(String(html))?.[1] ?? ''),
    canonical: tags(html, 'link')
      .filter((l) => l.rel === 'canonical')
      .map((l) => l.href),
    ogUrl: meta('og:url'),
    titles: [...meta('og:title'), ...meta('twitter:title'), ...meta('og:site_name')],
    images: [...meta('og:image'), ...meta('twitter:image')],
    robots: meta('robots'),
    jsonLd,
  };
}

/** The JSON-LD fields the server derives: each top-level object's name, url, image, and @id, and its main entity's and author's. */
function derivedJsonLd(objects) {
  const fields = [];
  const take = (object, where) => {
    if (!object || typeof object !== 'object') return;
    for (const key of ['name', 'url', 'image', '@id']) {
      if (typeof object[key] === 'string')
        fields.push({ where: `${where}.${key}`, value: object[key] });
    }
  };
  for (const object of objects) {
    take(object, object['@type'] ?? 'json-ld');
    take(object.mainEntity, `${object['@type']}.mainEntity`);
    take(object.author, `${object['@type']}.author`);
  }
  return fields;
}

const onOrigin = (value, origin) => value === origin || String(value).startsWith(`${origin}/`);

/**
 * Problems with what a server published about whose site it is.
 *
 * @param {{
 *   profile: 'owner' | 'read-only' | 'demo',
 *   origin: string,
 *   name: string,
 *   page: { status: number, body: string, headers?: Record<string, string> },
 *   sitemap: { status: number, body: string },
 *   robots: { status: number, body: string },
 *   feed: { status: number, body: string },
 *   ogImage?: { status: number, headers?: Record<string, string> },
 *   forbidden?: readonly string[],
 *   title?: string,
 * }} input `name` is the identity's: the fixture's under owner and
 *   read-only, the sample's under demo. `forbidden` adds to BUILD_LEAKS:
 *   the sample's name, or under demo, the fixtures', and the container's
 *   hostname. Under owner and read-only, `title` is what the page's
 *   <title>, og:title, twitter:title, and og:site_name must each carry.
 * @returns {string[]}
 */
export function identityProblems({
  profile,
  origin,
  name,
  page,
  sitemap,
  robots,
  feed,
  ogImage,
  forbidden = [],
  title,
}) {
  const problems = [];
  if (page.status !== 200) return [`/ answered ${page.status}`];
  const head = pageIdentity(page.body);
  const fields = [
    { where: 'title', value: head.title },
    ...head.canonical.map((value) => ({ where: 'canonical link', value })),
    ...head.ogUrl.map((value) => ({ where: 'og:url', value })),
    ...head.titles.map((value) => ({ where: 'a title meta tag', value })),
    ...head.images.map((value) => ({ where: 'og:image', value })),
  ];

  if (head.canonical.length !== 1 || head.canonical[0] !== `${origin}/`) {
    problems.push(`the canonical link is ${JSON.stringify(head.canonical)}, not ${origin}/`);
  }
  if (
    head.ogUrl.length !== 1 ||
    !onOrigin(head.ogUrl[0], origin) ||
    head.ogUrl[0].replace(/\/$/, '') !== origin
  ) {
    problems.push(`og:url is ${JSON.stringify(head.ogUrl)}, not ${origin}`);
  }
  if (
    head.images.length === 0 ||
    head.images.some((url) => !url.startsWith(`${origin}/opengraph-image`))
  ) {
    problems.push(
      `the Open Graph image is ${JSON.stringify(head.images)}, not ${origin}/opengraph-image`,
    );
  }
  if (
    ogImage &&
    (ogImage.status !== 200 || !/^image\//.test(ogImage.headers?.['content-type'] ?? ''))
  ) {
    problems.push(
      `the Open Graph image answered ${ogImage.status} ${ogImage.headers?.['content-type'] ?? ''}`,
    );
  }
  // Every profile answers both; a 500 or a failed fetch is a problem, not an empty list.
  if (sitemap.status !== 200) problems.push(`/sitemap.xml answered ${sitemap.status}`);
  if (robots.status !== 200) problems.push(`/robots.txt answered ${robots.status}`);
  const locs = [...String(sitemap.body).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]));
  const robotsUrls = [...String(robots.body).matchAll(/^(Host|Sitemap):\s*(\S+)/gim)].map((m) => ({
    key: m[1],
    value: m[2],
  }));
  fields.push(
    ...locs.map((value) => ({ where: 'sitemap', value })),
    ...robotsUrls.map(({ key, value }) => ({ where: `robots ${key}`, value })),
  );

  if (profile === 'demo') {
    if (!head.title.includes(name))
      problems.push(`the title is ${JSON.stringify(head.title)}, not the sample's`);
    if (head.jsonLd.length > 0)
      problems.push(`the page carries ${head.jsonLd.length} JSON-LD blocks; demo carries none`);
    if (locs.length > 0) problems.push(`the sitemap lists ${locs.length} URLs; demo's is empty`);
    if (robotsUrls.length > 0)
      problems.push(
        `robots.txt names ${robotsUrls.map((u) => u.key).join(', ')}; demo's names no host`,
      );
    if (feed.status !== 404) problems.push(`/feed.xml answered ${feed.status}; demo has no feed`);
    const robotsHeader = page.headers?.['x-robots-tag'];
    if (page.headers && !/noindex/.test(robotsHeader ?? '')) {
      problems.push(`the page's X-Robots-Tag is ${robotsHeader ?? 'unset'}, not noindex`);
    }
    // Under demo the whole page is the sample's.
    for (const leak of forbidden) {
      if (leak && page.body.includes(leak)) problems.push(`the page names ${leak}`);
    }
  } else {
    if (title !== undefined) {
      for (const [where, value] of [
        ['the title', head.title],
        ...head.titles.map((value) => ['a title meta tag', value]),
      ]) {
        if (!value.includes(title))
          problems.push(`${where} is ${JSON.stringify(value)}, not the identity's ${title}`);
      }
      if (head.titles.length === 0)
        problems.push('the page carries no og:title, twitter:title, or og:site_name');
    }
    const derived = derivedJsonLd(head.jsonLd);
    fields.push(...derived);
    const person = head.jsonLd.find((o) => o['@type'] === 'Person');
    if (!person) problems.push('the page carries no Person JSON-LD');
    else {
      if (person.name !== name)
        problems.push(`JSON-LD's Person is ${JSON.stringify(person.name)}, not ${name}`);
      if (person.url !== origin)
        problems.push(`JSON-LD's Person url is ${person.url}, not ${origin}`);
      if (person.image !== undefined && !onOrigin(person.image, origin)) {
        problems.push(`JSON-LD's Person image is ${person.image}, not on ${origin}`);
      }
    }
    for (const type of ['ProfilePage', 'WebSite']) {
      const object = head.jsonLd.find((o) => o['@type'] === type);
      if (!object) problems.push(`the page carries no ${type} JSON-LD`);
      else if (object.url !== origin)
        problems.push(`JSON-LD's ${type} url is ${object.url}, not ${origin}`);
      const person = object?.mainEntity ?? object?.author;
      if (object && person?.name !== name) {
        problems.push(`JSON-LD's ${type} names ${JSON.stringify(person?.name)}, not ${name}`);
      }
    }
    if (locs.length === 0) problems.push('the sitemap lists no URL');
    for (const loc of locs)
      if (!onOrigin(loc, origin)) problems.push(`the sitemap lists ${loc}, off ${origin}`);
    const host = robotsUrls.find((u) => u.key.toLowerCase() === 'host')?.value;
    const map = robotsUrls.find((u) => u.key.toLowerCase() === 'sitemap')?.value;
    if (host !== origin) problems.push(`robots.txt's Host is ${host ?? 'missing'}, not ${origin}`);
    if (map !== `${origin}/sitemap.xml`)
      problems.push(`robots.txt's Sitemap is ${map ?? 'missing'}, not ${origin}/sitemap.xml`);
    if (feed.status !== 200) problems.push(`/feed.xml answered ${feed.status}`);
    else {
      // The channel, which the server writes, and each item's guid on the site;
      // an item's link is the work's own, the author's to choose.
      const channel = String(feed.body).split('<item>')[0];
      const link = decode(/<link>([^<]*)<\/link>/.exec(channel)?.[1] ?? '');
      const self = decode(/<atom:link href="([^"]*)"/.exec(channel)?.[1] ?? '');
      if (link !== origin) problems.push(`the feed's link is ${link || 'missing'}, not ${origin}`);
      if (self !== `${origin}/feed.xml`)
        problems.push(`the feed's self link is ${self || 'missing'}, not ${origin}/feed.xml`);
      const guids = [...String(feed.body).matchAll(/<guid[^>]*>([^<]*)<\/guid>/g)].map((m) =>
        decode(m[1]),
      );
      const items = String(feed.body).split('<item>').length - 1;
      if (items === 0) problems.push('the feed lists no item');
      if (guids.length !== items)
        problems.push(`the feed has ${items} items and ${guids.length} guids`);
      for (const guid of guids)
        if (!onOrigin(guid, origin)) problems.push(`a feed item's guid is ${guid}, off ${origin}`);
      fields.push(
        { where: 'feed channel', value: channel },
        ...guids.map((value) => ({ where: 'feed guid', value })),
      );
    }
  }

  for (const { where, value } of fields) {
    for (const leak of [...BUILD_LEAKS, ...forbidden]) {
      if (leak && String(value).includes(leak))
        problems.push(`${where} names ${leak}: ${String(value).slice(0, 160)}`);
    }
  }
  return [...new Set(problems)];
}

/** The path of the page's Open Graph image, to fetch it, or null. */
export function ogImagePath(html, origin) {
  const [url] = pageIdentity(html).images;
  return url?.startsWith(`${origin}/`) ? url.slice(origin.length) : null;
}

/** The requests identityProblems reads, as { key: path }. */
export const IDENTITY_PATHS = Object.freeze({
  page: '/',
  sitemap: '/sitemap.xml',
  robots: '/robots.txt',
  feed: '/feed.xml',
});
