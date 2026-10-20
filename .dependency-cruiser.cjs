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
