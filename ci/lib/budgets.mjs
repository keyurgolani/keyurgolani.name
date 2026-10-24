// The runtime budget check's core (#6, items 3 and 4): pure functions over
// what pnpm check:budgets reads, so its tests feed them fixtures. A unit is
// a variant or one of #19's appearance packs, as ASSET_MANIFEST lists it.
// Each declares six budgets in its manifest; a kind it leaves out is held to
// the ceiling runtime-budgets.json sets for its tier or axis, and one it
// declares over that ceiling is a breach in itself. Every breach is a record
// of its own: the unit, the metric, the route where the trace measured it,
// the asset that carries the most of it, and every asset that adds to it.
// One unit's bytes are never summed with another's, one metric with
// another, or one trace case with another: a route's measure is its worst
// case.

/** The six kinds, in the order a report lists them. */
export const BUDGET_KINDS = ['js', 'css', 'image', 'font', 'animation', 'enhancement'];

/**
 * The environment the CI trace job builds with, so the trace can attribute
 * chunks through source maps. Only ci/budgets.mjs passes it, to that build
 * alone (ci/source-maps.test.mjs), and nothing that build writes reaches an
 * image or an uploaded artifact.
 */
export const ANALYZE_ENV = Object.freeze({ PORTFOLIO_ANALYZE: '1' });

const analyzeAssignments = () =>
  Object.entries(ANALYZE_ENV)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');

/**
 * The local command that rebuilds, traces, and checks what a record came
 * from: the fixture flag the build had, when it had one.
 *
 * @param {string | undefined} fixtures BUDGET_FIXTURES, as the check ran with it
 */
export function reproCommand(fixtures) {
  const flag = fixtures ? `BUDGET_FIXTURES=${fixtures} ` : '';
  return `${flag}${analyzeAssignments()} pnpm build && ${flag}pnpm test:trace && pnpm check:budgets`;
}

/** What to do about a build or trace without source maps. */
export const NEEDS_MAPS = `build with ${analyzeAssignments()} pnpm build, which ships source maps, and trace that`;

/** Which kinds the trace measures, once per case, and so per route. */
const TRACED = new Set(['js', 'animation']);

/** How a unit reads in a message: `variant fixture-over-budget`. */
export const label = (unit) => `${unit.kind} ${unit.id}`;

/** Where a unit's ceilings come from, for a message: `the light tier` or `the color-scheme axis`. */
export const rowName = (unit) =>
  unit.kind === 'variant' ? `the ${unit.performanceTier} tier` : `the ${unit.kind} axis`;

/**
 * The ceilings `unit` is held to: its tier's row for a variant, its axis's
 * for a pack. Null when runtime-budgets.json has none for it.
 *
 * @param {{ kind: string, performanceTier?: string }} unit
 * @param {{ tiers?: Record<string, Record<string, number>>, packs?: Record<string, Record<string, number>> }} ceilings
 */
export function ceilingsFor(unit, ceilings) {
  const row =
    unit.kind === 'variant' ? ceilings.tiers?.[unit.performanceTier] : ceilings.packs?.[unit.kind];
  return row ?? null;
}

/**
 * Each kind's declared budget, ceiling, and limit for `unit`: the limit is
 * what it declares, else its ceiling.
 */
export function limitsFor(unit, ceilings) {
  const row = ceilingsFor(unit, ceilings);
  return Object.fromEntries(
    BUDGET_KINDS.map((kind) => {
      const declared = unit.budgets?.[kind] ?? null;
      const ceiling = row?.[kind] ?? null;
      return [kind, { declared, ceiling, limit: declared ?? ceiling }];
    }),
  );
}

/** CSS with comments gone and escapes decoded, so `\68ttps:` reads as what a browser fetches. */
function plainCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, hex) => {
      const point = Number.parseInt(hex, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�';
    })
    .replace(/\\([^\n\r\f])/g, '$1');
}

/** The origin every unit file resolves against, standing in for the site's own. */
const UNIT_ORIGIN = 'https://unit.invalid';
const UNIT_BASE = `${UNIT_ORIGIN}/_portfolio/x/`;

/** The functions whose arguments a browser fetches: url(), src(), and both image-set()s. */
const URL_FUNCTIONS = new Set(['url', 'src', 'image-set', '-webkit-image-set']);

const HEX = /[0-9a-f]/i;
const NAME = /[a-z0-9_\-\u0080-\uffff]/i;
const SPACE = /[ \t\n\r\f]/;

/**
 * A CSS escape at `css[at]`, a backslash: what it stands for and where the
 * text goes on. A backslash before a newline, in a string, continues the
 * line and stands for nothing.
 */
function escapeAt(css, at) {
  let end = at + 1;
  if (end >= css.length) return { value: '�', end };
  if (HEX.test(css[end])) {
    let hex = '';
    while (end < css.length && hex.length < 6 && HEX.test(css[end])) hex += css[end++];
    if (end < css.length && SPACE.test(css[end]))
      end += css[end] === '\r' && css[end + 1] === '\n' ? 2 : 1;
    const point = Number.parseInt(hex, 16);
    const valid = point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
    return { value: valid ? String.fromCodePoint(point) : '�', end };
  }
  if (css[end] === '\n' || css[end] === '\f') return { value: '', end: end + 1 };
  if (css[end] === '\r') return { value: '', end: css[end + 1] === '\n' ? end + 2 : end + 1 };
  return { value: css[end], end: end + 1 };
}

/**
 * The tokens of `css` the URL scan reads, as CSS Syntax tokenizes them:
 * strings, unquoted url() contents, functions, at-keywords, and
 * parentheses, with escapes decoded and comments dropped.
 */
export function cssTokens(css) {
  const tokens = [];
  let at = 0;
  while (at < css.length) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      const close = css.indexOf('*/', at + 2);
      at = close === -1 ? css.length : close + 2;
    } else if (char === '"' || char === "'") {
      let value = '';
      at += 1;
      while (at < css.length && css[at] !== char && css[at] !== '\n') {
        if (css[at] === '\\') {
          const escape = escapeAt(css, at);
          value += escape.value;
          at = escape.end;
        } else value += css[at++];
      }
      at += 1;
      tokens.push({ type: 'string', value });
    } else if (char === '(' || char === ')') {
      tokens.push({ type: char });
      at += 1;
    } else if (NAME.test(char) || char === '\\' || char === '@') {
      const keyword = char === '@';
      if (keyword) at += 1;
      let name = '';
      while (at < css.length && (NAME.test(css[at]) || css[at] === '\\')) {
        if (css[at] === '\\') {
          const escape = escapeAt(css, at);
          name += escape.value;
          at = escape.end;
        } else name += css[at++];
      }
      if (keyword) {
        tokens.push({ type: 'at', name: name.toLowerCase() });
      } else if (css[at] === '(') {
        at += 1;
        const lower = name.toLowerCase();
        let ahead = at;
        while (ahead < css.length && SPACE.test(css[ahead])) ahead += 1;
        if (lower === 'url' && css[ahead] !== '"' && css[ahead] !== "'") {
          // An unquoted url(): its contents up to the ), escapes decoded.
          let value = '';
          at = ahead;
          while (at < css.length && css[at] !== ')') {
            if (css[at] === '\\') {
              const escape = escapeAt(css, at);
              value += escape.value;
              at = escape.end;
            } else value += css[at++];
          }
          at += 1;
          tokens.push({ type: 'url', value: value.replace(/[ \t\n\r\f]+$/, '') });
        } else tokens.push({ type: 'function', name: lower });
      }
    } else at += 1;
  }
  return tokens;
}

/** Every URL `css` fetches: each @import's, and each string or url() inside a URL function, nested ones included. */
export function urlTargets(css) {
  const tokens = cssTokens(css);
  const targets = [];
  // How deep the parentheses of each open URL function go.
  const open = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'at' && token.name === 'import') {
      const next = tokens[index + 1];
      if (next?.type === 'string' || next?.type === 'url') targets.push(next.value);
      continue;
    }
    if (token.type === 'function' || token.type === '(') {
      depth += 1;
      if (token.type === 'function' && URL_FUNCTIONS.has(token.name)) open.push(depth);
      continue;
    }
    if (token.type === ')') {
      if (open.at(-1) === depth) open.pop();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.type === 'url') targets.push(token.value);
    else if (token.type === 'string' && open.length > 0) targets.push(token.value);
  }
  return targets;
}

/**
 * Whether a browser fetching `target` from a unit's stylesheet reaches
 * another host: resolved against the site's own origin, as the URL parser
 * resolves it, it lands anywhere else. A data: URL fetches nothing.
 */
export function isRemote(target) {
  if (/^[\t\n\r\f ]*data:/i.test(target)) return false;
  try {
    return new URL(target, UNIT_BASE).origin !== UNIT_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Every URL a unit's stylesheet names that reaches another host: from an
 * @import, url(), src(), image-set(), or -webkit-image-set(), each string
 * in them read, resolved as a browser resolves it. A unit's files are its
 * own, and a public page makes no third-party request.
 *
 * @param {string} css
 */
export function remoteReferences(css) {
  return [...new Set(urlTargets(css).filter(isRemote))];
}

/**
 * The infinite animations a stylesheet declares: each `animation` or
 * `animation-iteration-count` declaration that says `infinite`. A pack's
 * animation measure, since a pack ships no script and the trace counts
 * what runs on a page against the variant it renders.
 *
 * @param {string} css
 */
export function infiniteDeclarations(css) {
  return [...plainCss(css).matchAll(/animation(?:-iteration-count)?\s*:([^;}]*)/gi)]
    .filter(([, value]) => /\binfinite\b/i.test(value))
    .map(([declaration]) => declaration.trim().replace(/\s+/g, ' '));
}

/** The path a request names on the app's origin, or null for another origin or no URL. */
export function pathOn(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(origin).origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Whether `source`, a module attribution names, is the file a unit's
 * enhancement export resolves to: the export's target in its package, such
 * as ./src/enhancements/glint.tsx, ending the module's path.
 */
const isEntry = (source, entry) =>
  entry !== null && (source === entry || source.endsWith(`/${entry.replace(/^\.\//, '')}`));

/**
 * The build's chunks that hold each of `unit`'s enhancements, with every
 * gzip byte in each, the unit's own and every package's beside it, so a 3D
 * library an enhancement loads counts against it. `chunks` is the build's attributed chunks,
 * each with the path it's served at; `entries` maps an enhancement id to
 * the file its export resolves to in the package, or null for none.
 *
 * @param {any} unit
 * @param {{ path: string, modules: { source: string, package: string, gzipBytes: number }[] }[]} chunks
 * @param {Record<string, string | null>} entries
 */
export function enhancementChunks(unit, chunks, entries) {
  return (unit.enhancements ?? []).map((enhancement) => {
    const entry = entries[enhancement.id] ?? null;
    const holding = chunks.filter((chunk) =>
      chunk.modules.some(
        (module) => module.package === unit.packageName && isEntry(module.source, entry),
      ),
    );
    return {
      id: enhancement.id,
      entry,
      // Everything in the chunk is the enhancement's to load: its own code, and the kit's,
      // three.js's, or any library's beside it, which nothing else on the page needed.
      chunks: holding.map((chunk) => ({
        path: chunk.path,
        gzipBytes: chunk.modules.reduce((total, module) => total + module.gzipBytes, 0),
      })),
    };
  });
}

const largestFirst = (assets) =>
  [...assets].sort((a, b) => b.amount - a.amount || a.asset.localeCompare(b.asset));
const total = (assets) => assets.reduce((sum, asset) => sum + asset.amount, 0);
const at = (site) => site ?? 'an unnamed site';

/**
 * The continuous work a trace case's probe counted, one asset per loop,
 * timer, and animation, as #62's counters count it: a frame loop and a
 * recurring timeout site as many as ran at once, an interval and an
 * infinite animation as one each.
 */
export function animationAssets(probe) {
  return [
    ...(probe?.frames?.loops ?? []).map((loop) => ({
      asset: `frame loop at ${at(loop.site)}`,
      amount: Math.max(1, loop.concurrent ?? 1),
    })),
    ...(probe?.timers?.intervals ?? []).map((timer) => ({
      asset: `interval at ${at(timer.site)}`,
      amount: 1,
    })),
    ...(probe?.timers?.timeouts ?? []).map((timer) => ({
      asset: `recurring timeout at ${at(timer.site)}`,
      amount: Math.max(1, timer.concurrent ?? 1),
    })),
    ...(probe?.animations?.infinite ?? []).map((animation) => ({
      asset: `${animation.kind} on ${animation.target}`,
      amount: 1,
    })),
  ];
}

/**
 * A variant's own JavaScript a trace case downloaded, chunk by chunk: its
 * package's gzip bytes in each JS chunk, by source map attribution, leaving
 * out the chunks that hold its enhancements, which `enhancement` counts.
 */
export function jsAssets(unit, entry, enhancementPaths) {
  return (entry.attribution?.chunks ?? [])
    .filter((chunk) => chunk.kind === 'js')
    .map((chunk) => ({
      asset: pathOn(chunk.url, entry.origin) ?? chunk.url,
      amount: (chunk.packages ?? [])
        .filter((pkg) => pkg.package === unit.packageName)
        .reduce((sum, pkg) => sum + pkg.gzipBytes, 0),
    }))
    .filter((asset) => asset.amount > 0 && !enhancementPaths.has(asset.asset));
}

/**
 * Each place a unit is measured, kind by kind, with its amount and the
 * assets that make it up, largest first. A stylesheet, image, or font is
 * measured once, from ASSET_MANIFEST. A variant's JS and animation are
 * measured once per trace case that renders it, and a pack's animation from
 * its stylesheet; a pack ships no script, so its JS and enhancements are 0.
 * Each enhancement is measured once, from the build's chunks.
 *
 * @param {object} input
 * @param {any} input.unit
 * @param {any[]} input.cases the trace cases that render it
 * @param {ReturnType<typeof enhancementChunks>} input.enhancements
 * @param {string | null} input.css its stylesheet's text, when the build has it
 */
export function measure({ unit, cases, enhancements, css }) {
  const once = (assets) => [{ amount: total(assets), assets: largestFirst(assets) }];
  const files = (list) => (list ?? []).map((file) => ({ asset: file.url, amount: file.bytes }));
  const enhancementPaths = new Set(enhancements.flatMap(({ chunks }) => chunks.map((c) => c.path)));
  const perCase = (read) =>
    cases.map((entry) => {
      const assets = read(entry);
      return {
        route: entry.route,
        profile: entry.profile ?? null,
        viewport: entry.viewport ?? null,
        amount: total(assets),
        assets: largestFirst(assets),
      };
    });
  const variant = unit.kind === 'variant';
  return {
    js: variant ? perCase((entry) => jsAssets(unit, entry, enhancementPaths)) : once([]),
    css: once(
      unit.stylesheet ? [{ asset: unit.stylesheet.url, amount: unit.stylesheet.gzipBytes }] : [],
    ),
    image: once([...files(unit.images), ...files(unit.stills)]),
    font: once(files(unit.fonts)),
    animation: variant
      ? perCase((entry) => animationAssets(entry.probe))
      : once(
          infiniteDeclarations(css ?? '').map((declaration) => ({
            asset: `${unit.stylesheet?.url ?? 'its stylesheet'}: ${declaration}`,
            amount: 1,
          })),
        ),
    enhancement: enhancements.map(({ id, chunks }) => ({
      enhancement: id,
      amount: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
      assets: largestFirst(chunks.map((chunk) => ({ asset: chunk.path, amount: chunk.gzipBytes }))),
    })),
  };
}

/** The manifest a unit's budgets are declared in, as a record's asset. */
const manifestOf = (unit) => `${unit.packageName} manifest.json`;

/**
 * Every breach, and every unit and kind checked: what pnpm check:budgets
 * writes to its report. A breach is one record each:
 *
 * - a unit over a limit where it was measured: once per route for JS and
 *   animation, from that route's worst trace case, with the other cases
 *   listed in the report; once per enhancement; once for the rest;
 * - a declared budget over its ceiling, or a unit with no ceiling row;
 * - a unit stylesheet with a remote @import or url(), or one the build
 *   output lacks;
 * - a file under /_portfolio/ a traced page loaded that ASSET_MANIFEST
 *   lists for no unit;
 * - a variant no trace case renders, or one whose cases have chunks
 *   without source maps;
 * - an enhancement no chunk of the build holds.
 *
 * @param {object} input
 * @param {any[]} input.units ASSET_MANIFEST's units
 * @param {{ url: string } | null} [input.platform] ASSET_MANIFEST's platform stylesheet
 * @param {any} input.ceilings runtime-budgets.json's budgets block
 * @param {{ cases?: any[] }} input.trace the trace report
 * @param {{ path: string, modules: any[] }[]} input.chunks the build's attributed chunks
 * @param {(unit: any) => Record<string, string | null>} input.entries each enhancement's file
 * @param {(url: string) => string | null} input.stylesheet a stylesheet's text, by URL
 */
export function checkBudgets({
  units,
  platform = null,
  ceilings,
  trace,
  chunks,
  entries,
  stylesheet,
}) {
  const records = [];
  const checked = [];
  const cases = trace?.cases ?? [];
  /**
   * The trace cases that requested any of `assets`, by URL path, in the
   * report's order: where a stylesheet, image, font, or chunk record's
   * route comes from, since the build measures those once.
   */
  const requestedOn = (assets) => {
    const paths = new Set(assets);
    return cases
      .filter((entry) =>
        (entry.requests ?? []).some((request) =>
          paths.has(pathOn(request.url, entry.origin ?? '') ?? ''),
        ),
      )
      .map(({ route, profile, viewport }) => ({
        route,
        profile: profile ?? null,
        viewport: viewport ?? null,
      }));
  };
  /** A record's route, profile, and viewport: the first case that requested its asset, and every one in `requestedOn`. */
  const where = (assets) => {
    const on = requestedOn(assets);
    const [first] = on;
    return first
      ? {
          route: first.route,
          profile: first.profile ?? undefined,
          viewport: first.viewport ?? undefined,
          requestedOn: on,
        }
      : {};
  };
  for (const unit of units) {
    const row = ceilingsFor(unit, ceilings);
    const limits = limitsFor(unit, ceilings);
    const rendering =
      unit.kind === 'variant' ? cases.filter((entry) => entry.composition === unit.id) : [];
    const enhancements = enhancementChunks(unit, chunks, entries(unit));
    const css = unit.stylesheet ? stylesheet(unit.stylesheet.url) : null;
    const measured = measure({ unit, cases: rendering, enhancements, css });
    if (!row) {
      records.push({
        unit,
        metric: 'ceiling',
        test: `${label(unit)} has no ceilings: runtime-budgets.json's budgets block needs a row for ${rowName(unit)}`,
        asset: 'runtime-budgets.json',
      });
    }
    for (const kind of BUDGET_KINDS) {
      const { declared, ceiling, limit } = limits[kind];
      if (declared !== null && ceiling !== null && declared > ceiling) {
        records.push({
          unit,
          metric: kind,
          test: `${label(unit)} declares a ${kind} budget of ${declared}, over ${rowName(unit)}'s ceiling of ${ceiling}`,
          asset: manifestOf(unit),
          actual: declared,
          threshold: ceiling,
        });
      }
      const routed = TRACED.has(kind) && unit.kind === 'variant';
      const worst = new Map();
      for (const entry of measured[kind]) {
        const key = routed ? entry.route : (entry.enhancement ?? '');
        const best = worst.get(key);
        if (!best || entry.amount > best.amount) worst.set(key, entry);
      }
      for (const [key, entry] of worst) {
        checked.push({
          kind: unit.kind,
          id: unit.id,
          metric: kind,
          ...(routed ? { route: key } : {}),
          ...(entry.enhancement ? { enhancement: entry.enhancement } : {}),
          actual: entry.amount,
          limit,
          limitFrom: declared !== null ? 'declared' : 'ceiling',
          assets: entry.assets,
          ...(routed
            ? {
                cases: measured[kind]
                  .filter((other) => other.route === key)
                  .map(({ profile, viewport, amount }) => ({ profile, viewport, amount })),
              }
            : {}),
        });
        if (limit === null || entry.amount <= limit) continue;
        const place = [
          entry.enhancement ? ` in enhancement ${entry.enhancement}` : '',
          routed ? ` on ${key}` : '',
        ].join('');
        const against = declared !== null ? 'declared budget' : `${rowName(unit)}'s ceiling`;
        records.push({
          unit,
          metric: kind,
          ...(routed
            ? {
                route: key,
                profile: entry.profile ?? undefined,
                viewport: entry.viewport ?? undefined,
              }
            : where(entry.assets.map(({ asset }) => asset))),
          test: `${label(unit)}'s ${kind}${place} is ${entry.amount}, over its ${against} of ${limit}; ${entry.assets[0]?.asset ?? 'no one asset'} carries ${entry.assets[0]?.amount ?? 0} of it`,
          asset: entry.assets[0]?.asset ?? manifestOf(unit),
          actual: entry.amount,
          threshold: limit,
          assets: entry.assets,
        });
      }
    }
    if (unit.kind === 'variant') {
      if (rendering.length === 0) {
        records.push({
          unit,
          metric: 'trace',
          test: `no trace case renders ${label(unit)}, so its JS and animation go unmeasured: trace every registered composition`,
          asset: manifestOf(unit),
        });
      }
      // A stylesheet ships without a map, and its bytes come from ASSET_MANIFEST;
      // a script without one leaves the unit's JS unknown.
      const unmapped = [
        ...new Set(
          rendering.flatMap((entry) =>
            (entry.attribution?.withoutMap ?? [])
              .map((url) => pathOn(url, entry.origin ?? '') ?? url)
              .filter((url) => /\.m?js$/i.test(url.replace(/[?#].*$/, ''))),
          ),
        ),
      ];
      const unattributed = rendering.filter((entry) => !entry.attribution?.chunks);
      if (unmapped.length > 0 || unattributed.length > 0) {
        records.push({
          unit,
          metric: 'trace',
          test: `the trace couldn't attribute ${label(unit)}'s JS, since ${unmapped.length > 0 ? `${unmapped.length} script(s) had no source map` : 'a case has no attribution'}: ${NEEDS_MAPS}`,
          asset: unmapped[0] ?? manifestOf(unit),
        });
      }
    }
    for (const { id, entry, chunks: holding } of enhancements) {
      if (holding.length > 0) continue;
      records.push({
        unit,
        metric: 'enhancement',
        test: `no chunk of the build holds ${label(unit)}'s enhancement ${id}${entry ? `, ${entry}` : ', whose export resolves to no file'}: ${NEEDS_MAPS}`,
        asset: manifestOf(unit),
      });
    }
    if (unit.stylesheet) {
      if (css === null) {
        records.push({
          unit,
          metric: 'remote',
          test: `${label(unit)}'s stylesheet isn't in the build output, so the check can't read it: run pnpm build`,
          asset: unit.stylesheet.url,
        });
      } else {
        const remote = remoteReferences(css);
        if (remote.length > 0) {
          records.push({
            unit,
            metric: 'remote',
            ...where([unit.stylesheet.url]),
            test: `${label(unit)}'s stylesheet reaches another host, and a unit's CSS may fetch only its own files: ${remote.join(', ')}`,
            asset: unit.stylesheet.url,
            actual: remote.length,
            threshold: 0,
            assets: remote.map((url) => ({ asset: url, amount: 1 })),
          });
        }
      }
    }
  }
  // A file under /_portfolio/ that no unit lists: ASSET_MANIFEST has to name
  // all a unit ships, or no budget counts its bytes.
  const listed = new Set([
    ...(platform ? [platform.url] : []),
    ...units.flatMap((unit) => [
      ...(unit.stylesheet ? [unit.stylesheet.url] : []),
      ...[...(unit.images ?? []), ...(unit.fonts ?? []), ...(unit.stills ?? [])].map((f) => f.url),
    ]),
  ]);
  const unlisted = new Map();
  for (const entry of cases) {
    for (const request of entry.requests ?? []) {
      const pathname = pathOn(request.url, entry.origin ?? '');
      if (!pathname?.startsWith('/_portfolio/') || listed.has(pathname)) continue;
      if (!unlisted.has(pathname)) unlisted.set(pathname, entry);
    }
  }
  for (const [pathname, entry] of unlisted) {
    const unit =
      units.find((one) => one.kind === 'variant' && one.id === entry.composition) ?? null;
    records.push({
      unit,
      metric: 'unlisted',
      route: entry.route,
      profile: entry.profile ?? undefined,
      viewport: entry.viewport ?? undefined,
      test: `${entry.route} loaded ${pathname}, which ASSET_MANIFEST lists for no unit, so no budget counts it`,
      asset: pathname,
    });
  }
  return { records, checked };
}

/**
 * A breach as a CI failure record (ci/failure-record.schema.json, 1.1): its
 * unit as `variant`, or as `pack` with its `axis`, and its metric.
 */
export function failureFields(record, { gate, reproCommand: command, artifacts }) {
  const { unit } = record;
  const pack = unit && unit.kind !== 'variant';
  return {
    schemaVersion: '1.1',
    gate,
    test: record.test,
    // A unit from ASSET_MANIFEST names its package packageName; one from the report, package.
    package: unit?.packageName ?? unit?.package,
    variant: unit && !pack ? unit.id : undefined,
    pack: pack ? unit.id : undefined,
    axis: pack ? unit.kind : undefined,
    profile: record.profile,
    route: record.route,
    viewport: record.viewport,
    asset: record.asset,
    metric: record.metric,
    actual: record.actual,
    threshold: record.threshold,
    artifacts,
    reproCommand: command,
  };
}

/** A record as the report keeps it: its unit by kind and id. */
export function reportRecord(record) {
  const { unit, ...rest } = record;
  return {
    unit: unit ? { kind: unit.kind, id: unit.id, package: unit.packageName } : null,
    ...rest,
  };
}
