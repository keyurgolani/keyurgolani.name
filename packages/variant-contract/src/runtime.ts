// What a visitor's page needs from the contract at run time, with no zod: the
// root entry also carries the manifest's schema and validators, which bring
// it (row 134). The appearance boundary, the kit's runtime and the variants'
// client modules import from here; public-zod.test.ts in apps/web holds them
// to it.

export { FALLBACK_ID } from './ids';
export { findVariant } from './registry';
export { documentKeyAction, isEditableTarget } from './keys';
export { routeHref } from './routes';
