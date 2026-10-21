// The bundled sample's identity, which a real deployment can't publish as its
// own. Startup refuses it in production (#1), and `pnpm config:validate` warns
// about it, so this module imports nothing server-only.

/** identity.name of each sample the image ships. */
export const BUNDLED_SAMPLE_NAMES: readonly string[] = ['Anamika Devi'];

/** Whether `name` is a bundled sample's, ignoring case, spacing, and Unicode form. */
export function isSampleIdentity(name: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return BUNDLED_SAMPLE_NAMES.some((sample) => normalize(sample) === normalize(name));
}
