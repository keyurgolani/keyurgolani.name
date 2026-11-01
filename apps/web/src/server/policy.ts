import { accessIn, CAPABILITIES, type Access, type Capability, type Profile } from './capabilities';
import { listRoutes, routeAccess, type RouteEntry } from './routes';
import { isMintedSession, type Session } from './session';

// CapabilityPolicy (#1, item 9): what a profile allows, from the capability
// matrix. authorize() decides through it, the server builds navigation from
// it, and readiness reports its summary. A session no provider minted counts
// as none.

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** What the profile grants, without paths, values, or content. */
export interface CapabilitySummary {
  readonly profile: Profile;
  readonly capabilities: readonly { readonly id: Capability; readonly access: Access }[];
}

export interface CapabilityPolicy {
  readonly profile: Profile;
  /** How the profile grants `capability`, or `absent`. */
  access(capability: Capability): Access | 'absent';
  /** Public capabilities for anyone; session ones only with a minted session. */
  allows(capability: Capability, session: Session | null): boolean;
  /** The pages the profile serves to this visitor, in route-table order. */
  navigation(session: Session | null): readonly NavLink[];
  summary(): CapabilitySummary;
}

export function capabilityPolicy(profile: Profile): CapabilityPolicy {
  const permits = (access: Access | 'absent', session: Session | null) =>
    access === 'public' || (access === 'session' && isMintedSession(session));
  const linked = (entry: RouteEntry): entry is RouteEntry & { nav: string } =>
    entry.kind === 'page' && entry.nav !== undefined && !entry.pattern.includes('[');

  return Object.freeze({
    profile,
    access: (capability: Capability) => accessIn(profile, capability),
    allows: (capability: Capability, session: Session | null) =>
      permits(accessIn(profile, capability), session),
    navigation: (session: Session | null) => {
      const links = new Map<string, NavLink>();
      for (const entry of listRoutes().filter(linked)) {
        if (permits(routeAccess(profile, entry), session) && !links.has(entry.pattern)) {
          links.set(entry.pattern, { href: entry.pattern, label: entry.nav });
        }
      }
      return [...links.values()];
    },
    summary: () => ({
      profile,
      capabilities: CAPABILITIES.flatMap((id) => {
        const access = accessIn(profile, id);
        return access === 'absent' ? [] : [{ id, access }];
      }),
    }),
  });
}
