import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkMarkdownPass, MARKERS } from './check-markdown-pass.mjs';

// The build gives React Server Components the Markdown post-pass and the
// browser none of it (#10). CI's build job runs the check after its build
// and the standalone check.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASS = '../../../../packages/kit/src/markdown-post-pass.ts';

/** A temporary .next tree holding `files`, path to content, removed after the test. */
function nextTree(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'markdown-pass-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const page = (...chunks) => chunks.map((chunk) => `R.c("server/chunks/ssr/${chunk}")`).join('\n');
const map = (...sources) => JSON.stringify({ version: 3, sources, mappings: '' });
const sectioned = (...sources) =>
  JSON.stringify({
    version: 3,
    sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, sources, mappings: '' } }],
  });

/** A build whose site and preview pages load the pass. */
const WIRED = {
  'server/app/(site)/page.js': page('a.js', 'b.js'),
  'server/app/(site)/work/[slug]/page.js': page('a.js', 'b.js'),
  'server/app/(preview)/preview/[grant]/[[...route]]/page.js': page('b.js'),
  'server/app/(studio)/studio/page.js': page('c.js'),
  'server/chunks/ssr/a.js': '',
  'server/chunks/ssr/a.js.map': map('../../../../packages/kit/src/sections/rich-text.tsx'),
  'server/chunks/ssr/b.js': '',
  'server/chunks/ssr/b.js.map': sectioned(
    PASS,
    '../../../../node_modules/.pnpm/sanitize-html@2.18.1/node_modules/sanitize-html/index.js',
  ),
  'server/chunks/ssr/c.js': '',
  'server/chunks/ssr/c.js.map': map('x.ts'),
  'static/chunks/app.js': 'console.log("x")',
};

test('a build whose site and preview pages load the post-pass, with none of it under static, passes', (t) => {
  assert.equal(checkMarkdownPass(nextTree(t, WIRED)), null);
});

test('a site or preview page that loads no chunk with the post-pass fails, by name', (t) => {
  const dir = nextTree(t, { ...WIRED, 'server/app/(site)/page.js': page('a.js') });
  assert.match(
    checkMarkdownPass(dir),
    /server\/app\/\(site\)\/page\.js loads no chunk with the Markdown post-pass \(packages\/kit\/src\/markdown-post-pass\.ts\)/,
  );
  const unmapped = nextTree(
    t,
    Object.fromEntries(
      Object.entries(WIRED).filter(([file]) => file !== 'server/chunks/ssr/b.js.map'),
    ),
  );
  assert.match(checkMarkdownPass(unmapped), /loads a chunk with no source map/);
});

test('a page that loads the post-pass on demand, through a chunk it names, passes; one only a missing chunk would bring fails (#6, Slice 2)', (t) => {
  // An experience segment imports its variant, and the kit's sections with it, on demand.
  const lazy = {
    ...WIRED,
    'server/app/(site)/page.js': page('a.js'),
    'server/chunks/ssr/a.js':
      'a.v(b=>Promise.all(["server/chunks/ssr/d.js"].map(b=>a.l(b))).then(()=>b(1)))',
    'server/chunks/ssr/d.js': 'a.l("server/chunks/ssr/b.js")',
    'server/chunks/ssr/d.js.map': map('x.ts'),
  };
  assert.equal(checkMarkdownPass(nextTree(t, lazy)), null);
  const missing = nextTree(t, {
    ...lazy,
    'server/chunks/ssr/a.js': 'a.l("server/chunks/ssr/gone.js")',
  });
  assert.match(
    checkMarkdownPass(missing),
    /server\/app\/\(site\)\/page\.js loads no chunk with the Markdown post-pass/,
  );
});

test('a server chunk with the renderer and not the post-pass fails, whatever else the page loads (#6, Slice 2)', (t) => {
  // e.js holds the renderer alone: the pages still load the pass through b.js,
  // so only this assertion catches a render that would skip it.
  const bare = nextTree(t, {
    ...WIRED,
    'server/chunks/ssr/e.js': '',
    'server/chunks/ssr/e.js.map': map('../../../../packages/kit/src/markdown.ts', 'y.ts'),
  });
  assert.match(
    checkMarkdownPass(bare),
    /server\/chunks\/ssr\/e\.js holds the renderer \(packages\/kit\/src\/markdown\.ts\) without the post-pass/,
  );
  // The renderer beside the pass, as the build has it, passes.
  const both = nextTree(t, {
    ...WIRED,
    'server/chunks/ssr/e.js': '',
    'server/chunks/ssr/e.js.map': map('../../../../packages/kit/src/markdown.ts', PASS),
  });
  assert.equal(checkMarkdownPass(both), null);
});

test("sanitize-html's code or a map of it under static fails, and so does a missing build", (t) => {
  for (const marker of MARKERS) {
    const dir = nextTree(t, { ...WIRED, 'static/chunks/x.js': `a.${marker}=1` });
    assert.match(
      checkMarkdownPass(dir),
      new RegExp(`static/chunks/x\\.js holds sanitize-html's code \\(${marker}\\)`),
    );
  }
  const mapped = nextTree(t, {
    ...WIRED,
    'static/chunks/y.js.map': map('../node_modules/sanitize-html/index.js'),
  });
  assert.match(checkMarkdownPass(mapped), /static\/chunks\/y\.js\.map maps sanitize-html/);
  assert.match(
    checkMarkdownPass(path.join(nextTree(t, {}), 'none')),
    /No build at .*Run pnpm build first\./,
  );
});

/** A client reference manifest for `entry`, as Next writes it, naming `entryFiles` and each client module's `chunks`. */
const manifest = (entry, entryFiles, ...modules) =>
  `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(`/${entry}`)}] = ${JSON.stringify(
    {
      moduleLoading: { prefix: '' },
      clientModules: Object.fromEntries(
        modules.map((chunks, index) => [
          `[project]/m${index}.tsx`,
          { id: index, name: '*', chunks, async: false },
        ]),
      ),
      entryCSSFiles: {},
      entryJSFiles: { [`[project]/apps/web/src/app/${entry}`]: entryFiles },
    },
  )};\n`;

/** Turbopack's on-demand load of `chunks`, as a browser chunk holds it. */
const loads = (...chunks) =>
  `e.v(t=>Promise.all(${JSON.stringify(chunks)}.map(t=>e.l(t))).then(()=>t(1)))`;

/**
 * A build with Demo Studio's local frame (#9): its page renders no Markdown on
 * the server, and in the browser its shell loads the post-pass on demand,
 * which no other page or route reaches.
 */
const LOCAL = {
  ...WIRED,
  'build-manifest.json': JSON.stringify({ rootMainFiles: ['static/chunks/main.js'] }),
  'static/chunks/main.js': 'console.log("main")',
  'server/app/(preview)/preview/local/page.js': page('l.js'),
  'server/chunks/ssr/l.js': '',
  'server/chunks/ssr/l.js.map': map('../../../../apps/web/src/app/(preview)/_local/local-preview.tsx'),
  'server/app/(preview)/preview/local/page_client-reference-manifest.js': manifest(
    '(preview)/preview/local/page',
    ['static/chunks/shell.js'],
    ['/_next/static/chunks/shell.js', '/_next/static/chunks/frame.js'],
  ),
  'static/chunks/shell.js': 'console.log("shell")',
  'static/chunks/frame.js': loads('static/chunks/pass.js'),
  'static/chunks/pass.js': 'a.recursiveEscape=1;a.allowedSchemesAppliedToAttributes=2',
  'static/chunks/pass.js.map': map('../node_modules/sanitize-html/index.js'),
  'server/app/(site)/page_client-reference-manifest.js': manifest(
    '(site)/page',
    ['static/chunks/app.js'],
    ['/_next/static/chunks/app.js'],
  ),
  'server/app/(studio)/studio/page_client-reference-manifest.js': manifest(
    '(studio)/studio/page',
    ['static/chunks/studio.js'],
  ),
  'static/chunks/studio.js': loads('static/chunks/studio-later.js'),
  'static/chunks/studio-later.js': 'console.log("later")',
  'server/app/api/health/route_client-reference-manifest.js': manifest('api/health/route', []),
};

test("the post-pass may sit under static only in chunks Demo Studio's local frame alone reaches, by the build's client reference manifests, and its page loads no renderer on the server (#9)", (t) => {
  assert.equal(checkMarkdownPass(nextTree(t, LOCAL)), null);
  // With no local frame in the build, nothing under static may hold it.
  const without = nextTree(
    t,
    Object.fromEntries(Object.entries(LOCAL).filter(([file]) => !file.includes('preview/local'))),
  );
  assert.match(checkMarkdownPass(without), /static\/chunks\/pass\.js holds sanitize-html's code \(recursiveEscape\)/);
  assert.match(checkMarkdownPass(without), /static\/chunks\/pass\.js\.map maps sanitize-html/);
  // A marker chunk no manifest reaches isn't the local frame's.
  const stray = nextTree(t, { ...LOCAL, 'static/chunks/stray.js': 'a.recognizeSelfClosing=1' });
  assert.match(
    checkMarkdownPass(stray),
    /static\/chunks\/stray\.js holds sanitize-html's code \(recognizeSelfClosing\)/,
  );
  // The local page's server render with the renderer fails, by name.
  const rendered = nextTree(t, {
    ...LOCAL,
    'server/chunks/ssr/l.js.map': map('../../../../packages/kit/src/markdown.ts', PASS),
  });
  assert.match(
    checkMarkdownPass(rendered),
    /server\/app\/\(preview\)\/preview\/local\/page\.js, Demo Studio's local frame, loads a server chunk with the renderer \(packages\/kit\/src\/markdown\.ts\)/,
  );
});

test("a chunk with the post-pass that the local frame shares with any other page or route fails, however the other reaches it (#9)", (t) => {
  const shared = 'reaches it beside server/app/\\(preview\\)/preview/local/page';
  const cases = {
    // Another page's manifest names it for a client module.
    'a client module of another page': {
      'server/app/(site)/page_client-reference-manifest.js': manifest(
        '(site)/page',
        ['static/chunks/app.js'],
        ['/_next/static/chunks/app.js', '/_next/static/chunks/pass.js'],
      ),
    },
    // Another page's entry names it.
    "another page's entry": {
      'server/app/(site)/page_client-reference-manifest.js': manifest('(site)/page', [
        'static/chunks/app.js',
        'static/chunks/pass.js',
      ]),
    },
    // Studio's chunk loads it on demand, a step further out.
    "Studio's chunk, on demand": {
      'static/chunks/studio-later.js': loads('static/chunks/frame.js'),
    },
    // A route handler's manifest names it.
    "a route's manifest": {
      'server/app/api/health/route_client-reference-manifest.js': manifest('api/health/route', [
        'static/chunks/pass.js',
      ]),
    },
  };
  for (const [what, files] of Object.entries(cases)) {
    const problem = checkMarkdownPass(nextTree(t, { ...LOCAL, ...files }));
    assert.match(problem ?? '', new RegExp(`static/chunks/pass\\.js holds sanitize-html's code \\(recursiveEscape\\), and \\S+ ${shared}`), what);
    assert.match(problem ?? '', new RegExp(`static/chunks/pass\\.js\\.map maps sanitize-html, and \\S+ ${shared}`), what);
  }
  // The chunk every page loads reaching it reaches it from every page.
  const everywhere = checkMarkdownPass(
    nextTree(t, { ...LOCAL, 'static/chunks/main.js': loads('static/chunks/pass.js') }),
  );
  assert.match(
    everywhere ?? '',
    /static\/chunks\/pass\.js holds sanitize-html's code \(recursiveEscape\), and server\/app\/\(site\)\/page, server\/app\/\(studio\)\/studio\/page, server\/app\/api\/health\/route reaches it beside/,
  );
  // A manifest the check can't read could reach it, so it fails too.
  const unreadable = checkMarkdownPass(
    nextTree(t, {
      ...LOCAL,
      'server/app/(studio)/studio/page_client-reference-manifest.js': 'self.__RSC_MANIFEST=x',
    }),
  );
  assert.match(
    unreadable ?? '',
    /static\/chunks\/pass\.js holds sanitize-html's code \(recursiveEscape\), and server\/app\/\(studio\)\/studio\/page has a client reference manifest the check can't read/,
  );
});

test("CI's build job runs the check right after the standalone check", () => {
  const workflow = parseYaml(
    readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  const runs = workflow.jobs.build.steps.map((step) => step.run).filter(Boolean);
  assert.equal(runs[runs.indexOf('pnpm ci:standalone') + 1], 'pnpm ci:markdown-pass');
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    scripts['ci:markdown-pass'],
    'node ci/run.mjs markdown-pass -- pnpm check:markdown-pass',
  );
  assert.equal(scripts['check:markdown-pass'], 'node ci/check-markdown-pass.mjs');
});
