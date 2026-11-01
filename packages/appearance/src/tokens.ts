// Token contract 1 (#19, Slice 1, item 1): every custom property the packs
// and the compiler define, by axis. Color schemes own `--color-*`, design
// languages `--ui-*`, and typography profiles `--type-*`; variants define
// only `--layout-*`. Within major 1, a new role needs a default derived from
// roles that already exist, so packs written before it keep working;
// renaming or removing a role, or a slot part, bumps the major. The lists
// themselves are in ./roles, which imports nothing.
//
// The version itself is #5's TOKEN_CONTRACT_VERSION, the one constant
// validateManifest() already checks variants against. This package imports
// @portfolio/variant-contract and never the reverse, so the constant has one
// home and no import cycle.

export { TOKEN_CONTRACT_VERSION } from '@portfolio/variant-contract';
export * from './roles';
