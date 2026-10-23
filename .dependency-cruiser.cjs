// Module boundary rules for `pnpm check:deps`, including the variant contract's
// (#5): what a variant may import, and what the contract's browser-safe root
// entry may.
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

/**
 * The workspace packages that are variants: their package.json says
 * `portfolio.kind: "variant"`, whatever their folder is called, so a renamed
 * or new one is covered the moment it's declared.
 */
function variantDirs() {
  const packages = path.join(__dirname, 'packages');
  return readdirSync(packages).filter((dir) => {
    try {
      const manifest = JSON.parse(readFileSync(path.join(packages, dir, 'package.json'), 'utf8'));
      return manifest.portfolio?.kind === 'variant';
    } catch {
      return false;
    }
  });
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A pattern that matches nothing when there's no variant.
const VARIANT_DIRS = variantDirs().map(escapeRegExp).join('|') || '(?!)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make module order fragile and block tree-shaking.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: 'Shared packages must not depend on an app; apps depend on packages.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'variants-import-only-the-contract-packages',
      severity: 'error',
      comment:
        "A variant imports @portfolio/schema, @portfolio/variant-contract, @portfolio/kit, and #19's " +
        '@portfolio/appearance, never the host, the server-only @portfolio/core, or another variant ' +
        '(#5). Its own files and third-party libraries are fine. A variant is a package whose ' +
        'package.json has portfolio.kind "variant".',
      from: { path: `^packages/(${VARIANT_DIRS})/` },
      to: {
        path: '^(?:packages|apps)/',
        pathNot: ['^packages/$1/', '^packages/(?:schema|kit|variant-contract|appearance)/'],
      },
    },
    {
      name: 'variant-contract-root-stays-browser-safe',
      severity: 'error',
      comment:
        "@portfolio/variant-contract's root entry runs in browsers, in #7's preview frame and #9's " +
        'in-browser render, so it imports only zod and the browser-safe @portfolio/schema (#5, ' +
        'Slice 1). Node-only code goes in its ./node subpath; tests may import anything.',
      from: {
        path: '^packages/variant-contract/src/',
        pathNot: ['\\.test\\.ts$', '^packages/variant-contract/src/node/'],
      },
      to: {
        pathNot: [
          '^packages/variant-contract/src/(?!node/)',
          '^packages/schema/src/(?!node\\.ts$|migrate/)',
          '^node_modules/(\\.pnpm/zod@|zod/)',
        ],
      },
    },
    {
      name: 'appearance-root-stays-browser-safe',
      severity: 'error',
      comment:
        "@portfolio/appearance's root entry runs in browsers too, in #7's preview frames and #9's " +
        'Demo Studio, and so do its ./generators, so they import only zod, the browser-safe ' +
        "@portfolio/schema, and @portfolio/variant-contract's root: no React, no Node, no next/*, " +
        'not the Node-only ./node (#19, Slices 1 and 2), and not the React entries, ./react and ' +
        './primitives (Slice 3). It imports the token contract version from that root, which the ' +
        'rule above keeps from importing back. ./generators loads no package at all, which its ' +
        'own test holds it to. Tests and their test support may import anything.',
      from: {
        path: '^packages/appearance/src/',
        pathNot: [
          '\\.test\\.tsx?$',
          '^packages/appearance/src/test-support/',
          '^packages/appearance/src/(node|react|primitives)/',
        ],
      },
      to: {
        pathNot: [
          '^packages/appearance/src/(?!test-support/|node/|react/|primitives/)',
          '^packages/variant-contract/src/(?!node/)',
          '^packages/schema/src/(?!node\\.ts$|migrate/)',
          '^node_modules/(\\.pnpm/zod@|zod/)',
        ],
      },
    },
    {
      name: 'appearance-react-entries-stay-browser-safe',
      severity: 'error',
      comment:
        "@portfolio/appearance's ./react and ./primitives render on the server and in the browser, " +
        "in #7's frames and #9's Demo Studio too, so they import what the root may, each other, and " +
        'React itself, and nothing from Node, next/*, react-dom/server, or the Node-only ./node ' +
        '(#19, Slice 3). The host passes VisitorAppearance its refresh. Tests and their test ' +
        'support may import anything.',
      from: {
        path: '^packages/appearance/src/(react|primitives)/',
        pathNot: ['\\.test\\.tsx?$'],
      },
      to: {
        pathNot: [
          '^packages/appearance/src/(?!test-support/|node/)',
          '^packages/variant-contract/src/(?!node/)',
          '^packages/schema/src/(?!node\\.ts$|migrate/)',
          '^node_modules/(\\.pnpm/zod@|zod/)',
          '^node_modules/\\.pnpm/react@[^/]+/node_modules/react/',
          '^node_modules/\\.pnpm/react-dom@[^/]+/node_modules/react-dom/(?!server)',
        ],
      },
    },
    {
      name: 'owner-code-only-from-composition',
      severity: 'error',
      comment:
        'Owner code loads only through the composition root, so demo and read-only never ' +
        'evaluate it (#1, item 14). All of @portfolio/core is owner code (#2), and its modules ' +
        'import each other. The owner CLI, apps/web/bin/owner.mjs, runs on its own and imports ' +
        'the PHC module by path. Tests may import it.',
      from: {
        pathNot: [
          '^apps/web/src/server/(owner/|composition\\.ts$)',
          '^packages/core/',
          '^apps/web/bin/owner\\.mjs$',
          '\\.test\\.(?:tsx?|mjs)$',
        ],
      },
      to: { path: ['^apps/web/src/server/owner/', '^packages/core/'] },
    },
    {
      name: 'composition-loads-owner-code-only-through-import',
      severity: 'error',
      comment:
        'startup.ts imports the composition root in every profile, so the root reaches owner ' +
        'code only through import() in its owner branch, never a static or type import (#1, item 14).',
      from: { path: '^apps/web/src/server/composition\\.ts$' },
      to: {
        path: ['^apps/web/src/server/owner/', '^packages/core/'],
        dependencyTypesNot: ['dynamic-import'],
      },
    },
    {
      name: 'proxy-reads-only-the-route-table-and-config',
      severity: 'error',
      comment:
        'proxy.ts runs before every request; it imports only the route table, the capability ' +
        'matrix behind it, the frozen config (#1, item 15), the body /api/ready answers ' +
        "before startup (item 19), for Studio (#2) its headers, the session cookie's name, " +
        'and returnTo, and for preview (#7) its headers and its status document, none of which ' +
        'reads a session. A grant path is checked through the port the owner composition binds ' +
        'into the frozen config, which reads the grant and its session by digest, never a cookie.',
      from: { path: '^apps/web/src/proxy\\.ts$' },
      to: {
        pathNot: [
          '^apps/web/src/server/(capabilities|routes|config-store|ready-starting)\\.ts$',
          '^apps/web/src/server/(studio-headers|session-cookie|return-to|preview-headers)\\.ts$',
          '^apps/web/src/preview/status\\.ts$',
          '^node_modules/(\\.pnpm/next@|next/)',
        ],
      },
    },
    {
      name: 'preview-imports-no-studio',
      severity: 'error',
      comment:
        'A preview document (#7) shows what a visitor gets, so nothing in app/(preview) or ' +
        "src/preview imports Studio's route group or host-chrome.css, whose sentinel and " +
        'markup would reach the frame (threat preview-9). Tests may.',
      from: {
        path: '^apps/web/src/(?:app/\\(preview\\)/|preview/)',
        pathNot: '\\.test\\.tsx?$',
      },
      to: { path: ['^apps/web/src/app/\\(studio\\)/', 'host-chrome\\.css$'] },
    },
    {
      name: 'preview-protocol-imports-zod-and-ids-only',
      severity: 'error',
      comment:
        "The preview's message protocol (#7, Slice 3) is read by both sides and by Node tests, " +
        'so it imports zod and the browser-safe @portfolio/schema/ids and nothing else: no ' +
        'React, no Next, no server code.',
      from: { path: '^apps/web/src/preview/protocol\\.ts$' },
      to: {
        pathNot: ['^node_modules/(\\.pnpm/zod@|zod/)', '^packages/schema/src/ids\\.ts$'],
      },
    },
    {
      name: 'preview-studio-channel-imports-protocol-only',
      severity: 'error',
      comment:
        "Studio's half of the preview channel (#7, Slice 3) imports the protocol and nothing " +
        "else, so nothing a frame sends can reach Studio's transport through it (threat " +
        'preview-3), and Slice 4 wraps it without its UI. depcruise resolves relative and ' +
        "package imports, not ~/ ones: protocol.test.ts walks those, and the browser spec's " +
        'chunk check covers what reaches a page.',
      from: { path: '^apps/web/src/preview/studio-channel\\.ts$' },
      to: { pathNot: '^apps/web/src/preview/protocol\\.ts$' },
    },
    {
      name: 'preview-agent-imports-the-frame-channel-only',
      severity: 'error',
      comment:
        'The preview agent (#7, Slice 3) runs in every preview document, so it, the status ' +
        "report, and the frame's half of the channel import that half, the protocol, and React, " +
        "and nothing else: never Studio's half, which would ship in the frame (threat " +
        'preview-3). An allowlist, so an import spelled with ~/, which depcruise leaves ' +
        'unresolved, fails it too.',
      from: { path: '^apps/web/src/preview/(?:agent|report-status|frame-channel)\\.tsx?$' },
      to: {
        pathNot: [
          '^apps/web/src/preview/(?:frame-channel|protocol)\\.ts$',
          '^node_modules/(?:\\.pnpm/react@|react/)',
        ],
      },
    },
    {
      name: 'preview-documents-import-only-the-agent-side',
      severity: 'error',
      comment:
        "A preview document (#7, Slice 3) loads the agent's side of the channel and never " +
        "Studio's: from src/preview, app/(preview) imports the agent, the status report and " +
        "texts, and the frame channel's types, and nothing else. An allowlist within " +
        "src/preview, in either spelling, so an import of Studio's half written with ~/ fails " +
        'it too. Tests may import anything.',
      from: { path: '^apps/web/src/app/\\(preview\\)/', pathNot: '\\.test\\.tsx?$' },
      to: {
        path: '^(?:apps/web/src/|~/)preview/',
        pathNot:
          '^(?:apps/web/src/|~/)preview/(?:agent|report-status|status|frame-channel)(?:\\.ts|\\.tsx)?$',
      },
    },
    {
      name: 'store-test-support-only-from-tests',
      severity: 'error',
      comment:
        "The revision store's test support, with the only FsPort whose crash points act, is for " +
        'tests: nothing but a test, or the test support itself, imports it (#3).',
      from: {
        pathNot: ['\\.test\\.(?:tsx?|mjs)$', '^packages/core/src/store/test-support/'],
      },
      to: { path: '^packages/core/src/store/test-support/' },
    },
    {
      name: 'migration-only-from-its-command',
      severity: 'error',
      comment:
        'The migration converts old documents offline (#4, item 19). The web runtime, the kit, ' +
        'the variants, and the rest of the schema package never import it, so no page or ' +
        'server ships it; pnpm config:migrate and tests may.',
      from: {
        pathNot: ['^packages/schema/src/migrate/', '^apps/web/scripts/', '\\.test\\.(?:tsx?|mjs)$'],
      },
      to: { path: '^packages/schema/src/migrate/' },
    },
    {
      name: 'pair-loader-only-on-the-server',
      severity: 'error',
      comment:
        '@portfolio/schema/node reads the pair from disk (#4, item 5), so only server code, ' +
        'the config command, and tests import it. The validator it wraps stays browser-safe.',
      from: {
        pathNot: ['^apps/web/src/server/', '^apps/web/scripts/', '\\.test\\.(?:tsx?|mjs)$'],
      },
      to: { path: '^packages/schema/src/node\\.ts$' },
    },
    {
      name: 'operation-registry-imports-no-handlers',
      severity: 'error',
      comment:
        'The operation registry is data; the composition root binds handlers by name, so ' +
        'loading the registry never loads owner code (#1, item 10).',
      from: { path: '^apps/web/src/server/operations\\.ts$' },
      to: {
        pathNot: ['^apps/web/src/server/capabilities\\.ts$', '^node_modules/(\\.pnpm/zod@|zod/)'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.next|dist|coverage|__fixtures__)/' },
    // Workspace packages resolve through their pnpm symlinks to packages/*.
    preserveSymlinks: false,
    tsPreCompilationDeps: true,
    // Absolute, so the tsconfig's own `extends` resolves from apps/web.
    tsConfig: { fileName: require('node:path').join(__dirname, 'apps/web/tsconfig.json') },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
