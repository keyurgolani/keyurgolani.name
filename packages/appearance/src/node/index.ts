// @portfolio/appearance/node (#19, Slice 2): the Node-only half. The pack
// compiler and the platform stylesheet, which registry generation runs
// through the hooks apps/web/scripts/build-registry.ts passes it, and the
// computed gate `pnpm check:appearance` runs over a registry. Nothing here
// runs in a browser.

export {
  compileGeneratedScheme,
  compilePack,
  compileSchemeStylesheet,
  MAX_FONT_BYTES,
  namespacedStack,
  PACK_URL,
  packFile,
  schemeBaseSets,
  type CompiledPack,
  type CompileProblem,
  type CompileResult,
  type PackFile,
  type PackSource,
} from './compile';
export { compilePlatform, platformStylesheet } from './platform';
export {
  MAX_STYLESHEET_BYTES,
  readLanguageStylesheet,
  writeStyleNodes,
  type StyleDeclaration,
  type StyleGroup,
  type StyleNode,
  type StyleRule,
  type StylesheetProblem,
  type StylesheetResult,
} from './stylesheet';
export { LAYER_ORDER, startsWithLayerOrder } from '../layers';
