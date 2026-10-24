import type { StudioPolicy } from '~/lib/studio/backend';
import type { Capability, Profile } from './capabilities';
import { capabilityPolicy } from './policy';
import type { Session } from './session';

// What the Studio shell may do (#8, Slice 1 item 5): the Studio capabilities
// #1's CapabilityPolicy grants the page's session, by name, and the
// profile, which picks the shell's backend. The shell lists a task, and
// offers a write, only for what this allows; the server still decides each
// request through #2's guard.

/** The capabilities the shell reads, in no particular order. */
export const SHELL_CAPABILITIES: readonly Capability[] = [
  'studio.view',
  'draft.read',
  'draft.write',
  'history.read',
  'asset.write',
  'preview.grant',
  'publish',
  'rollback',
  'config.status',
];

export function studioPolicy(profile: Profile, session: Session | null): StudioPolicy {
  const policy = capabilityPolicy(profile);
  return {
    profile,
    allowed: SHELL_CAPABILITIES.filter((capability) => policy.allows(capability, session)),
  };
}
