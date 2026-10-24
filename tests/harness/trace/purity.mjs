// The experience plane's purity (#6, Slice 2, item 6): what an owner or
// read-only public page may reference, load, and link. pnpm test:trace
// gathers the evidence for each public page it loads: the document's HTML
// and the RSC payload inside it, every request, the links and stylesheets in
// the DOM, and the source-map attribution of every chunk the page downloads
// or its HTML and RSC payload name (attribution.mjs). purityProblems() says
// what's wrong with it:
//
// - a module that matches a glob in runtime-budgets.json's `forbidden`
//   block, such as Studio's and the preview's code;
// - an unselected unit: a module from another unit's package, or a
//   stylesheet or file of a unit the page doesn't render, by
//   ASSET_MANIFEST (apps/web/src/lib/generated/asset-manifest.json);
// - a third-party request;
// - a link to /studio or /admin;
// - CSS from anything but experience-base.css and the selected units.
//
// Modules are matched through source maps, so a chunk without one fails
// the page: only a PORTFOLIO_ANALYZE=1 build ships them.
import { readdirSync } from 'node:fs';
import path from 'node:path';

/** The host stylesheet every public page may load, as attribution names its source. */
export const BASE_STYLESHEET = 'apps/web/src/app/experience-base.css';

/** #19's pack kinds, each the boundary attribute that names the pack it renders, data-<kind>. */
export const PACK_KINDS = ['design-language', 'color-scheme', 'typography'];

/** Where the host serves units' files (packages/variant-contract VARIANT_URL, ASSET_URL, and #19's packs). */
const UNIT_FILES = /^\/_portfolio\/(variant|pack|asset)\/[^/]+$/;

/** Where Next serves the build's chunks. */
const NEXT_STATIC = '/_next/static/';

/** Paths no public page links to: Studio, and the retired /admin. */
const HOST_ONLY = ['/studio', '/admin'];

/** The directories a forbidden glob may name files in, and what a walk of them skips. */
const SOURCE_DIRS = ['apps', 'packages'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);

/**
 * A glob as a regular expression over a POSIX path relative to the
 * repository root: `**` is any run of path segments, none included, `*`
 * any run of characters but `/`, and `?` one of them. Everything else,
 * parentheses and brackets among it, stands for itself.
 *
 * @param {string} glob
 */
export function globRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        pattern += '(?:.*/)?';
      } else {
        pattern += '.*';
      }
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Every file under `root`'s apps/ and packages/, as a POSIX path relative
 * to it, sorted: what a forbidden glob has to match one of. Dependencies,
 * build output, and symbolic links are skipped.
 *
 * @param {string} root
 */
export function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return files.sort();
}

/**
 * runtime-budgets.json's `forbidden` block, checked: a description, and
 * `modules`, each a glob relative to the repository root under apps/ or
 * packages/ with its rationale. A glob that matches none of `files` is a
 * problem, as is a malformed block, so a rename can't leave a rule that
 * guards nothing.
 *
 * @param {any} budgets runtime-budgets.json, parsed
 * @param {readonly string[]} files sourceFiles() of the repository
 * @returns {{ rules: { glob: string, rationale: string, pattern: RegExp }[], problems: string[] }}
 */
export function forbiddenRules(budgets, files) {
  const block = budgets?.forbidden;
  const problems = [];
  if (!block || typeof block !== 'object' || !Array.isArray(block.modules)) {
    return { rules: [], problems: ['runtime-budgets.json has no forbidden.modules list.'] };
  }
  const rules = [];
  const seen = new Set();
  block.modules.forEach((entry, index) => {
    const at = `forbidden.modules[${index}]`;
    const glob = entry?.glob;
    if (typeof glob !== 'string' || typeof entry?.rationale !== 'string' || !entry.rationale) {
      problems.push(`${at} needs a glob and a rationale.`);
      return;
    }
    if (!/^(?:apps|packages)\/[^\s\\]+$/.test(glob) || /(?:^|\/)\.\.?(?:\/|$)/.test(glob)) {
      problems.push(
        `${at}, ${glob}, isn't a path under apps/ or packages/ relative to the repository root.`,
      );
      return;
    }
    if (seen.has(glob)) {
      problems.push(`${at}, ${glob}, is listed twice.`);
      return;
    }
    seen.add(glob);
    const pattern = globRegExp(glob);
    if (!files.some((file) => pattern.test(file))) {
      problems.push(
        `${at}, ${glob}, matches no file in the repository: fix it, or drop it if what it guarded is gone.`,
      );
    }
    rules.push({ glob, rationale: entry.rationale, pattern });
  });
  return { rules, problems };
}

/** The text of an HTML attribute value, its character references decoded. */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (match, name) => {
    const lower = name.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

/**
 * The RSC payload a server-rendered page carries: the strings its
 * `self.__next_f.push([1, "..."])` scripts add, joined in order, and how
 * many of those it couldn't read.
 *
 * @param {string} html
 */
export function flightPayload(html) {
  const parts = [];
  let unreadable = 0;
  for (const [, literal] of html.matchAll(
    /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g,
  )) {
    try {
      parts.push(JSON.parse(literal));
    } catch {
      unreadable += 1;
    }
  }
  return { text: parts.join(''), pushes: parts.length, unreadable };
}

const TAG = /<(a|area|link|script|form|button|input|iframe|img|source)\b([^>]*)>/gi;
const ATTRIBUTE = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** A tag's attributes, by lowercase name, values decoded. */
function attributesOf(source) {
  const attributes = {};
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
    attributes[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attributes;
}

/** `value` resolved against `base`, or null when it isn't a URL. */
function resolved(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/** A chunk path as a Next payload or page writes it, as the URL the browser would fetch. */
function chunkUrl(match, base) {
  const pathname = match.startsWith('/_next/') ? match : `/_next/${match.replace(/^\//, '')}`;
  return resolved(pathname, base);
}

/**
 * What a page's document names: the chunks and stylesheets its tags and its
 * RSC payload reference, the unit files (/_portfolio/...) anywhere in either,
 * and every link target, a tag's or a payload prop's.
 *
 * @param {string} html the document as served
 * @param {string} pageUrl its URL
 * @returns {{ chunks: string[], unitFiles: string[], links: string[], flight: { pushes: number, unreadable: number, bytes: number } }}
 */
export function documentReferences(html, pageUrl) {
  const flight = flightPayload(html);
  const chunks = new Set();
  const unitFiles = new Set();
  const links = new Set();
  for (const [, tag, source] of html.matchAll(TAG)) {
    const name = tag.toLowerCase();
    const attributes = attributesOf(source);
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/);
    if (name === 'a' || name === 'area') {
      if (attributes.href) links.add(resolved(attributes.href, pageUrl));
    } else if (name === 'form') {
      if (attributes.action) links.add(resolved(attributes.action, pageUrl));
    } else if (name === 'button' || name === 'input') {
      if (attributes.formaction) links.add(resolved(attributes.formaction, pageUrl));
    } else if (name === 'iframe') {
      if (attributes.src) links.add(resolved(attributes.src, pageUrl));
    } else if (name === 'link' && attributes.href) {
      const url = resolved(attributes.href, pageUrl);
      if (
        rel.some((value) => ['stylesheet', 'preload', 'modulepreload', 'prefetch'].includes(value))
      ) {
        chunks.add(url);
      } else if (!rel.includes('icon') && !rel.includes('canonical') && !rel.includes('manifest')) {
        links.add(url);
      }
    } else if (name === 'script' && attributes.src) {
      chunks.add(resolved(attributes.src, pageUrl));
    }
  }
  for (const text of [html, flight.text]) {
    for (const [match] of text.matchAll(
      /(?:\/_next\/)?static\/(?:chunks|css)\/[A-Za-z0-9_\-.~%/]+?\.(?:js|css)(?![A-Za-z0-9_\-.~%/])/g,
    )) {
      chunks.add(chunkUrl(match, pageUrl));
    }
    for (const [match] of text.matchAll(
      /\/_portfolio\/(?:variant|pack|asset)\/[A-Za-z0-9_\-.]+/g,
    )) {
      unitFiles.add(resolved(match, pageUrl));
    }
  }
  for (const [, href] of flight.text.matchAll(
    /"(?:href|action|formAction)":"((?:[^"\\]|\\.)*)"/g,
  )) {
    try {
      links.add(resolved(JSON.parse(`"${href}"`), pageUrl));
    } catch {
      // Not a JSON string after all: the tags above still had their say.
    }
  }
  // A unit file is one wherever it's named, and a payload's href for a
  // stylesheet or chunk is no link.
  const asset = (url) => {
    const { pathname } = new URL(url);
    return UNIT_FILES.test(pathname) || pathname.startsWith(NEXT_STATIC);
  };
  for (const url of [...chunks]) {
    if (url && UNIT_FILES.test(new URL(url).pathname)) {
      chunks.delete(url);
      unitFiles.add(url);
    }
  }
  return {
    chunks: [...chunks].filter(Boolean).sort(),
    unitFiles: [...unitFiles].filter(Boolean).sort(),
    links: [...links].filter((url) => url && !asset(url)).sort(),
    flight: { pushes: flight.pushes, unreadable: flight.unreadable, bytes: flight.text.length },
  };
}

/**
 * The units a page renders: the variant the trace selected, and, once the
 * page's document boundary is #19's (data-appearance-boundary="document"),
 * the packs its data-<kind> attributes name and the platform stylesheet
 * every such boundary links.
 *
 * @param {{ units: any[], platform: any }} manifest asset-manifest.json, parsed
 * @param {string} composition the variant id that renders
 * @param {Record<string, string> | null} boundary the document boundary's attributes
 */
export function selectedUnits(manifest, composition, boundary) {
  const units = manifest.units.filter(
    (unit) =>
      (unit.kind === 'variant' && unit.id === composition) ||
      (PACK_KINDS.includes(unit.kind) && boundary?.[`data-${unit.kind}`] === unit.id),
  );
  const appearance = boundary?.['data-appearance-boundary'] === 'document';
  return { units, platform: appearance ? (manifest.platform ?? null) : null };
}

/** A URL's path on `origin`, or null for another origin's. */
function pathOn(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/** Whether a path, as the app would route it, is Studio's or /admin. */
function hostOnly(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Kept as written.
  }
  const lower = decoded.toLowerCase().replace(/\/+$/, '') || '/';
  return HOST_ONLY.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

/** `kind id`, as problems name a unit. */
const label = (unit) => `${unit.kind} ${unit.id}`;

/**
 * What's wrong with one public page, by the rules at the top of this file,
 * each problem once.
 *
 * @param {object} page
 * @param {{ units: any[], platform: any }} page.manifest asset-manifest.json, parsed
 * @param {string} page.composition the variant that renders
 * @param {string} page.appOrigin the app's origin
 * @param {ReadonlyArray<{ url: string, kind: string, thirdParty: boolean }>} page.requests what the page requested
 * @param {ReadonlyArray<{ url: string, kind: 'js' | 'css', modules: ReadonlyArray<{ source: string, package?: string }> }>} page.chunks
 *   every chunk attributed, downloaded or only referenced
 * @param {readonly string[]} page.withoutMap the chunks attribution had no map for
 * @param {ReturnType<typeof documentReferences>} page.references
 * @param {{ boundary: Record<string, string> | null, links: readonly string[], stylesheets: readonly string[], scripts?: readonly string[], styleElements: readonly number[] }} page.dom
 *   `scripts` are the settled DOM's script sources and script preloads
 * @param {ReadonlyArray<{ glob: string, pattern: RegExp }>} page.forbidden forbiddenRules()'s rules
 * @param {readonly string[]} [page.forbiddenProblems] forbiddenRules()'s problems
 * @param {Partial<Record<string, string>>} [page.errorPacks] the pack on each kind the error
 *   page renders in, whose stylesheet a page may name but not load
 * @returns {{ selected: { units: string[], platform: string | null }, problems: string[] }}
 */
export function purityProblems(page) {
  const { manifest, composition, appOrigin, dom } = page;
  const problems = new Set(page.forbiddenProblems ?? []);
  const selected = selectedUnits(manifest, composition, dom.boundary);
  const variant = selected.units.find((unit) => unit.kind === 'variant');
  if (!variant) problems.add(`ASSET_MANIFEST lists no variant ${composition}.`);
  const rendered = dom.boundary?.['data-variant'] ?? null;
  if (rendered !== composition) {
    problems.add(`The page's boundary renders ${rendered ?? 'no variant'}, not ${composition}.`);
  }

  // Each unit file by URL path, and the ones the selected units may load.
  const owners = new Map();
  for (const unit of manifest.units) {
    for (const file of [unit.stylesheet, ...unit.fonts, ...unit.images, ...unit.stills]) {
      if (file) owners.set(file.url, unit);
    }
  }
  const allowed = new Set(
    selected.units.flatMap((unit) =>
      [unit.stylesheet, ...unit.fonts, ...unit.images, ...unit.stills]
        .filter(Boolean)
        .map((file) => file.url),
    ),
  );
  if (manifest.platform && selected.platform) allowed.add(manifest.platform.url);
  const unitPackages = new Map();
  for (const unit of manifest.units) {
    unitPackages.set(unit.packageName, [...(unitPackages.get(unit.packageName) ?? []), unit]);
  }
  const selectedPackages = new Set(selected.units.map((unit) => unit.packageName));

  for (const request of page.requests) {
    if (request.thirdParty) problems.add(`A third-party request: ${request.url}`);
  }

  for (const url of [...dom.links, ...page.references.links]) {
    const pathname = pathOn(url, appOrigin);
    if (pathname !== null && hostOnly(pathname)) {
      problems.add(`A link to ${pathname}: no public page links to Studio or /admin.`);
    }
  }

  // Unit files, wherever the page names or loads one.
  const loaded = new Set(
    [...page.requests.map((request) => request.url), ...dom.stylesheets]
      .map((url) => pathOn(url, appOrigin))
      .filter(Boolean),
  );
  // The error page's fallback packs (#19, Slice 4): a page in a document
  // boundary names their stylesheets in its payload, for the error page it
  // may need, and loads none of them unless it does.
  const errorSheets = new Set(
    selected.platform
      ? manifest.units
          .filter(
            (unit) => PACK_KINDS.includes(unit.kind) && page.errorPacks?.[unit.kind] === unit.id,
          )
          .map((unit) => unit.stylesheet?.url)
          .filter(Boolean)
      : [],
  );
  const unitUrls = new Set([
    ...page.requests.map((request) => request.url),
    ...page.references.unitFiles,
    ...dom.stylesheets,
  ]);
  for (const url of unitUrls) {
    const pathname = pathOn(url, appOrigin);
    if (pathname === null || !pathname.startsWith('/_portfolio/')) continue;
    if (allowed.has(pathname)) continue;
    if (errorSheets.has(pathname) && !loaded.has(pathname)) continue;
    const owner = owners.get(pathname);
    problems.add(
      owner
        ? `${pathname} is ${label(owner)}'s, which the page doesn't render.`
        : `${pathname} is no registered unit's file in ASSET_MANIFEST.`,
    );
  }

  // CSS: experience-base.css, through Next's chunks, and the selected units' files.
  const chunks = new Map(page.chunks.map((chunk) => [chunk.url, chunk]));
  const withoutMap = new Set(page.withoutMap);
  const stylesheets = new Set([
    ...page.requests.filter((request) => request.kind === 'stylesheet').map(({ url }) => url),
    ...dom.stylesheets,
    ...page.references.chunks.filter((url) => /\.css(?:$|\?)/.test(url)),
  ]);
  for (const url of stylesheets) {
    const pathname = pathOn(url, appOrigin);
    if (pathname === null || pathname.startsWith('/_portfolio/')) continue;
    if (!pathname.startsWith(NEXT_STATIC)) {
      problems.add(
        `A stylesheet from neither experience-base.css nor a selected unit: ${pathname}`,
      );
    }
  }
  for (const chunk of page.chunks) {
    if (chunk.kind !== 'css') continue;
    for (const source of chunk.modules) {
      if (source.source !== BASE_STYLESHEET) {
        problems.add(
          `${pathOn(chunk.url, appOrigin) ?? chunk.url} holds CSS from ${source.source} (${source.package}): a public page's CSS comes only from experience-base.css and the selected units.`,
        );
      }
    }
  }
  if (dom.styleElements.some((length) => length > 0)) {
    problems.add(
      `The page has ${dom.styleElements.filter((length) => length > 0).length} <style> element(s) with CSS in them: a public page's CSS comes only from experience-base.css and the selected units.`,
    );
  }

  // Every module of every chunk: no forbidden one, and no other unit's.
  for (const chunk of page.chunks) {
    const where = pathOn(chunk.url, appOrigin) ?? chunk.url;
    for (const source of chunk.modules) {
      for (const rule of page.forbidden) {
        if (rule.pattern.test(source.source)) {
          problems.add(
            `${where} holds ${source.source}, which ${rule.glob} forbids on a public page.`,
          );
        }
      }
      const units = unitPackages.get(source.package);
      if (units && !selectedPackages.has(source.package)) {
        problems.add(
          `${where} holds ${source.source}, from ${units.map(label).join(', ')}, which the page doesn't render.`,
        );
      }
    }
  }

  // A page's code is evidence only once attributed: with no JS chunk
  // attributed, nothing above saw it, and the page fails rather than passes.
  if (!page.chunks.some((chunk) => chunk.kind === 'js' && chunk.modules.length > 0)) {
    problems.add(
      "No JS chunk was attributed, so none of the page's code was checked: trace a PORTFOLIO_ANALYZE=1 build.",
    );
  }

  // A chunk with no map can't be checked, so it fails the page, and so does
  // a script the HTML, the payload, the DOM, or a request names that isn't
  // among the attributed chunks.
  const named = new Set([
    ...page.references.chunks,
    ...page.requests.map(({ url }) => url),
    ...(dom.scripts ?? []),
  ]);
  for (const url of [...withoutMap, ...[...named].filter((url) => !chunks.has(url))]) {
    const pathname = pathOn(url, appOrigin);
    if (pathname === null || !pathname.startsWith(NEXT_STATIC)) continue;
    if (!/\.(?:m?js|css)$/.test(pathname)) continue;
    problems.add(
      `${pathname} has no source map, so its modules can't be checked: build with PORTFOLIO_ANALYZE=1.`,
    );
  }

  // The selected variant's own stylesheet loads: else ASSET_MANIFEST isn't this build's.
  const requested = new Set(page.requests.map(({ url }) => pathOn(url, appOrigin)));
  if (variant?.stylesheet && !requested.has(variant.stylesheet.url)) {
    problems.add(
      `${variant.stylesheet.url}, ${label(variant)}'s stylesheet, never loaded: is ASSET_MANIFEST this build's?`,
    );
  }

  return {
    selected: {
      units: selected.units.map(label),
      platform: selected.platform?.url ?? null,
    },
    problems: [...problems],
  };
}

/**
 * The pack stylesheets a page's RSC payload names that it doesn't render
 * (#19): every /_portfolio/pack/ file in the payload, less the platform
 * stylesheet, the packs the document boundary's data-<kind> attributes
 * name, and, in a document boundary, the error page's fallback packs, which
 * it names for the error page it may need, exactly as purityProblems() allows. The visitor control's
 * model once named every registered pack's stylesheet here, so a page
 * carried the whole catalog's URLs; it names none now, and the preference
 * route answers a save with the new selection's.
 *
 * @param {string} html the document as served
 * @param {{ units: any[], platform: any }} manifest asset-manifest.json, parsed
 * @param {Record<string, string> | null} boundary the document boundary's attributes
 * @param {Partial<Record<string, string>>} [errorPacks] the pack on each kind the error page renders in
 * @returns {string[]} the paths, sorted
 */
export function unrenderedPayloadPacks(html, manifest, boundary, errorPacks = {}) {
  const allowed = new Set();
  // Only a document boundary links the platform stylesheet and names the
  // error page's packs, as purityProblems() allows them.
  const document = boundary?.['data-appearance-boundary'] === 'document';
  if (manifest.platform?.url && document) allowed.add(manifest.platform.url);
  for (const unit of manifest.units) {
    if (!PACK_KINDS.includes(unit.kind) || !unit.stylesheet) continue;
    if (
      boundary?.[`data-${unit.kind}`] === unit.id ||
      (document && errorPacks[unit.kind] === unit.id)
    ) {
      allowed.add(unit.stylesheet.url);
    }
  }
  const named = new Set(
    [...flightPayload(html).text.matchAll(/\/_portfolio\/pack\/[A-Za-z0-9_\-.]+/g)].map(
      ([match]) => match,
    ),
  );
  return [...named].filter((url) => !allowed.has(url)).sort();
}
