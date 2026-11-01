import { documentBinding, type DocumentBinding } from '@portfolio/variant-contract';

// The document key binding a page listens for (K-4 (d), the delta review's N1):
// the manifest's, less `/` where the page has no visitor control. `/` is a
// single character, which the visitor must be able to turn off (WCAG
// 2.1.4), and only a visitor page's control shows the Single-key shortcuts
// toggle; a Studio preview frame, /preview/dev, and Demo Studio's local frame
// show none, and a sandboxed frame can't read the visitor's stored choice
// either. So there the binding keeps its modifier keys alone.

/** The binding the page's host listens for, or undefined where none is left to listen for. */
export function pageBinding(
  manifest: Parameters<typeof documentBinding>[0],
  { visitorControl }: { readonly visitorControl: boolean },
): DocumentBinding | undefined {
  const declared = documentBinding(manifest);
  if (!declared) return undefined;
  const keys = visitorControl ? declared.keys : declared.keys.filter((key) => key !== '/');
  return keys.length > 0 ? { ...declared, keys } : undefined;
}
