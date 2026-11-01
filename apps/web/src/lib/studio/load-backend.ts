// The one place Owner Studio's adapter loads from (#8, #9): its own chunk,
// which the owner shell asks for only under owner. Demo Studio's shell loads
// its browser backend with an import() of its own
// (`app/(studio)/_components/demo/demo-shell.tsx`), so nothing Demo Studio
// loads names this module or the adapter. Nothing else imports either
// backend, outside tests.

type OwnerModule = typeof import('./owner-backend');

/** The owner adapter's module. */
export function loadOwnerBackend(): Promise<OwnerModule> {
  return import('./owner-backend');
}
