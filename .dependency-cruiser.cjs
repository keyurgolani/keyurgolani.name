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
        'Demo Studio, so it imports only zod, the browser-safe @portfolio/schema, and ' +
        "@portfolio/variant-contract's root: no React, no Node, and no next/* (#19, Slice 1). It " +
        'imports the token contract version from that root, which the rule above keeps from ' +
        'importing back. Tests and their test support may import anything.',
      from: {
        path: '^packages/appearance/src/',
        pathNot: ['\\.test\\.ts$', '^packages/appearance/src/test-support/'],
      },
      to: {
        pathNot: [
          '^packages/appearance/src/(?!test-support/)',
          '^packages/variant-contract/src/(?!node/)',
          '^packages/schema/src/(?!node\\.ts$|migrate/)',
          '^node_modules/(\\.pnpm/zod@|zod/)',
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
        "before startup (item 19), and for Studio (#2) its headers, the session cookie's name, " +
        'and returnTo, none of which reads a session.',
      from: { path: '^apps/web/src/proxy\\.ts$' },
      to: {
        pathNot: [
          '^apps/web/src/server/(capabilities|routes|config-store|ready-starting)\\.ts$',
          '^apps/web/src/server/(studio-headers|session-cookie|return-to)\\.ts$',
          '^node_modules/(\\.pnpm/next@|next/)',
        ],
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
