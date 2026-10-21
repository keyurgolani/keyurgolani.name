// What a variant renders from (#5, Slice 3, item 4, shipped with the
// contract): one JSON-serializable input, built the same way by the host, by
// #7's preview frame, and by #9's render in the visitor's browser. So the
// builder is pure and browser-safe: no Node module, no environment, no clock,
// no network, and no Web Crypto, which plain-HTTP pages lack. The caller
// passes the time.

import {
  canonicalize,
  type DisplayMode,
  type MotionPolicy,
  type PublicPortfolio,
  type PublicView,
  type SiteFeatures,
  type VisitorControls,
} from '@portfolio/schema';
import { contentIndex, materializeControls, type ControlValues } from './controls';
import type { VariantManifest, ViewDeclaration } from './manifest-schema';
import { normalizeBasePath, type RouteTarget } from './routes';
import { sha256 } from './sha256';
import { CONTRACT_VERSION } from './version';

export interface VariantRenderInput {
  readonly contract: typeof CONTRACT_VERSION;
  /** The rendering variant's id. */
  readonly variant: string;
  /** What the rendering variant's manifest declares that rendering reads, so a variant needn't import its manifest. */
  readonly capabilities: {
    /** The kinds the variant renders bespoke. Every other kind it doesn't skip renders shared. */
    readonly renderedKinds: readonly string[];
    /** The kinds the variant deliberately doesn't render. */
    readonly unsupportedKinds: readonly string[];
    /** Its views, for href(). */
    readonly views: readonly ViewDeclaration[];
    /** Its enhancements, for loadEnhancement(). */
    readonly enhancements: NonNullable<VariantManifest['enhancements']>;
  };
  /** Visible content only: no hidden section and no unregistered extension data. */
  readonly portfolio: PublicPortfolio;
  /** How the site presents it. The appearance ids are #19's to resolve. */
  readonly presentation: {
    readonly displayMode: DisplayMode;
    readonly motionPolicy: MotionPolicy;
    readonly visitorControls: VisitorControls;
    readonly features: SiteFeatures;
  };
  /** Every control's value, defaults filled in. */
  readonly controls: ControlValues;
  readonly route: RouteTarget;
  /** Where the routes are mounted, for href(): '' for the site root. */
  readonly basePath: string;
  /** The deployment's canonical origin, such as https://jane.name. */
  readonly origin: string;
  /** Data derived from the content, such as GitHub's. Empty until #10. */
  readonly derived: Readonly<Record<string, never>>;
  /** Media metadata. Empty until #10. */
  readonly media: Readonly<Record<string, never>>;
  /** Resolved appearance tokens. Null until #19. */
  readonly appearance: null;
  readonly env: {
    /** The request time, truncated to the UTC day, as an ISO string. */
    readonly now: string;
    /** A number fixed by the visible content, for decoration that must not change between renders. */
    readonly seed: number;
  };
  readonly ids: {
    /** What every id the variant renders starts with, so a host page and a frame can share a document. */
    readonly prefix: string;
    /** The id of the variant's one <main>, which the host's skip link targets. */
    readonly main: string;
  };
}

export interface RenderInputArgs {
  /** The pair's public view, from toPublicView(). */
  readonly view: PublicView;
  /** The rendering variant's manifest. */
  readonly manifest: VariantManifest;
  readonly route: RouteTarget;
  readonly basePath: string;
  /** The deployment's canonical origin (#1's PORTFOLIO_ORIGIN on the server). */
  readonly origin: string;
  /** When the request arrived. */
  readonly requestTime: Date | number | string;
  /** Lowercase words ending in a hyphen, such as `pv-`, or '' for none. */
  readonly idPrefix?: string;
}

const ID_PREFIX = /^(?:[a-z][a-z0-9-]*-)?$/;

/** Builds a variant's render input. It throws when an argument isn't what the type says. */
export function buildRenderInput(args: RenderInputArgs): VariantRenderInput {
  const { view, manifest, route } = args;
  const origin = new URL(args.origin).origin;
  if (origin !== args.origin) {
    throw new TypeError('The origin is a scheme, host, and port alone, such as https://jane.name.');
  }
  const prefix = args.idPrefix ?? '';
  if (!ID_PREFIX.test(prefix)) {
    throw new TypeError('An id prefix is lowercase words ending in a hyphen, such as pv-.');
  }
  const time = new Date(args.requestTime);
  if (Number.isNaN(time.getTime())) throw new TypeError("The request time isn't a valid time.");
  const day = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate()));

  const site = view.site;
  const controls = materializeControls(
    manifest,
    site.variantControls?.[manifest.id],
    contentIndex(view.portfolio),
  );
  return {
    contract: CONTRACT_VERSION,
    variant: manifest.id,
    capabilities: {
      renderedKinds: manifest.renderedKinds,
      unsupportedKinds: manifest.unsupportedKinds,
      views: manifest.routes.views,
      enhancements: manifest.enhancements ?? [],
    },
    portfolio: view.portfolio,
    presentation: {
      displayMode: site.appearance.displayMode,
      motionPolicy: site.motionPolicy,
      visitorControls: site.visitorControls,
      features: site.features,
    },
    controls,
    route,
    basePath: normalizeBasePath(args.basePath),
    origin,
    derived: {},
    media: {},
    appearance: null,
    env: { now: day.toISOString(), seed: viewSeed(view) },
    ids: { prefix, main: `${prefix}main` },
  };
}

/**
 * The first 8 hex digits of the SHA-256 of the public view's canonical JSON,
 * as an integer. The same visible content always gives the same seed, in
 * every runtime, and an edit to a hidden section changes nothing.
 */
export function viewSeed(view: PublicView): number {
  const digest = sha256(new TextEncoder().encode(canonicalize(view)));
  return ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
}
