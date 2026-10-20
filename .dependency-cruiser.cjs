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
        'evaluate it (#1, item 14). That includes the owner modules @portfolio/core exports.',
      from: { pathNot: '^apps/web/src/server/(owner/|composition\\.ts$)' },
      to: { path: ['^apps/web/src/server/owner/', '^packages/core/src/owner([./]|$)'] },
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
