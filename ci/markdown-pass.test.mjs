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
  'server/chunks/ssr/a.js.map': map('../../../../packages/kit/src/markdown.ts'),
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
