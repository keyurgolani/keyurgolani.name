// What keeps a valid pack out of a production registry (#20). A pack whose
// manifest breaks the contract fails registry generation, as #5's contract
// errors do. A pack that is valid but may not ship, such as one under a
// license no pack may ship under, is excluded instead: registry generation
// leaves it out, writes nothing of it to what the host serves, and lists it
// with its reason, so selecting it falls back on its axis and says why.

import { ALLOWED_LICENSES, UPSTREAM_LICENSES, type UpstreamLicense } from './manifests';

/** Whether `license` is one of the upstream licenses whose notice the third-party notices carry. */
export function isUpstreamLicense(license: string): license is UpstreamLicense {
  return (UPSTREAM_LICENSES as readonly string[]).includes(license);
}

/**
 * Why a valid pack can't ship under its license, or null when it can. The
 * allowlist is exact: an SPDX expression such as `MIT OR GPL-3.0` or a
 * near spelling such as `mit` names no license on it.
 */
export function licenseExclusion(manifest: {
  readonly provenance: { readonly license: string };
}): string | null {
  const { license } = manifest.provenance;
  if (ALLOWED_LICENSES.includes(license)) return null;
  return `its license, ${license}, isn't one a pack may ship under: ${ALLOWED_LICENSES.join(', ')}.`;
}
