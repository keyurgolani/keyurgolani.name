// Module boundary rules for `pnpm check:deps`. #5 (variant contract) adds the
// variant-to-host rules here.
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
      name: 'owner-code-only-from-composition',
      severity: 'error',
      comment:
        'Owner code loads only through the composition root, so demo and read-only never ' +
        'evaluate it (#1, item 14). That includes the owner modules @portfolio/core exports. ' +
        'Tests may import it.',
      from: { pathNot: ['^apps/web/src/server/(owner/|composition\\.ts$)', '\\.test\\.tsx?$'] },
      to: { path: ['^apps/web/src/server/owner/', '^packages/core/src/owner([./]|$)'] },
    },
    {
      name: 'composition-loads-owner-code-only-through-import',
      severity: 'error',
      comment:
        'startup.ts imports the composition root in every profile, so the root reaches owner ' +
        'code only through import() in its owner branch, never a static or type import (#1, item 14).',
      from: { path: '^apps/web/src/server/composition\\.ts$' },
      to: {
        path: ['^apps/web/src/server/owner/', '^packages/core/src/owner([./]|$)'],
        dependencyTypesNot: ['dynamic-import'],
      },
    },
    {
      name: 'proxy-reads-only-the-route-table-and-config',
      severity: 'error',
      comment:
        'proxy.ts runs before every request; it imports only the route table, the capability ' +
        'matrix behind it, the frozen config (#1, item 15), and the body /api/ready answers ' +
        'before startup (item 19).',
      from: { path: '^apps/web/src/proxy\\.ts$' },
      to: {
        pathNot: [
          '^apps/web/src/server/(capabilities|routes|config-store|ready-starting)\\.ts$',
          '^node_modules/(\\.pnpm/next@|next/)',
        ],
      },
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
