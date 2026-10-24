'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ResolvedAppearance } from '@portfolio/appearance';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { installPostPass } from '@portfolio/kit/markdown-local';
import type { VariantComponent } from '@portfolio/kit/sections';
import { resolvePortfolioView, type Context, type Site } from '@portfolio/schema';
import {
  buildRenderInput,
  contractValidators,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { appearanceCatalog, appearanceValidator } from '~/lib/appearance-checks';
import type { Composition } from '~/lib/composition';
import { validateImport } from '~/lib/demo/import/pipeline';
import { resolveDocumentAppearance } from '~/lib/document-appearance-core';
import { CONTENT_EXTENSIONS, EXTENSION_RENDERED_KINDS } from '~/lib/generated/registry.extensions';
import { VARIANT_LOADERS } from '~/lib/generated/registry.loaders';
import { ClientHostModules } from '~/lib/host-modules-client';
import { resolveVisitorPathIn } from '~/lib/visitor-dispatch';
import { reportFrameStatus, routeOf, startFrameChannel } from './frame-channel';
import { localRegistries, type LocalCatalog, type LocalRegistries } from './local-catalog';
import type { ToFramePayload } from './protocol';

// Demo Studio's local preview frame (#7, Slice 6; #9): it renders the
// document Studio sends over the frame's port, in the browser, so a
// visitor's imported or edited content never reaches a server. It runs #4's
// validator again with this build's catalog, builds #10's public view with
// no media document, so no media URL the content names reaches the page,
// resolves the route and the appearance as the server would, and renders
// the composition's `.` export. Markdown renders through the server's own
// post-pass, which this module installs and waits for: until it's in, and
// if it never arrives, the frame renders no document at all. Routes stay
// in memory. The frame's policy connects to nothing, and its sandbox gives
// it an opaque origin, with no storage, cookies, or reach into Studio.

/** Where the frame's internal links start. */
export const LOCAL_LINK_BASE = '/preview/local';

/** The appearance axes a document's selection may set, as Demo Studio's URL keeps them. */
const AXES = ['variant', 'designLanguage', 'colorScheme', 'typography', 'displayMode'] as const;

export type LocalDocumentMessage = ToFramePayload<'document'>;

/** What a document renders as, or why it doesn't. */
export type LocalRender =
  | {
      readonly kind: 'render';
      readonly input: VariantRenderInput;
      readonly composition: Composition;
      readonly appearance: ResolvedAppearance;
      readonly lang?: 'en';
    }
  | { readonly kind: 'redirect'; readonly route: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' };

/** What a local document is checked against: this build's catalog, extensions, and validators. */
export function localContext(registries: LocalRegistries): Context {
  return {
    catalog: appearanceCatalog(registries.appearance),
    extensions: CONTENT_EXTENSIONS,
    validators: [
      ...contractValidators(registries.variants, {
        live: true,
        extensionRenderers: EXTENSION_RENDERED_KINDS,
      }),
      appearanceValidator(registries.appearance, true),
    ],
  };
}

/** The site with Studio's selection on its appearance: each axis it names as text, and no other key. */
export function withSelection(site: Site, selection: Readonly<Record<string, string>>): Site {
  const chosen = Object.fromEntries(
    AXES.flatMap((axis) =>
      Object.hasOwn(selection, axis) && typeof selection[axis] === 'string'
        ? [[axis, selection[axis]]]
        : [],
    ),
  );
  return { ...site, appearance: { ...site.appearance, ...chosen } };
}

/** The host's own words are English: marked so inside a portfolio in another language. */
function hostLang(locale: string): 'en' | undefined {
  const lower = locale.toLowerCase();
  return lower === 'en' || lower.startsWith('en-') ? undefined : 'en';
}

/** What `document` renders as at `route`, below the frame's link base. */
export async function renderLocal({
  document,
  route,
  registries,
  origin,
  requestTime = new Date(),
}: {
  readonly document: LocalDocumentMessage;
  readonly route: string;
  readonly registries: LocalRegistries;
  readonly origin: string;
  readonly requestTime?: Date;
}): Promise<LocalRender> {
  const checked = validateImport(document.sources, localContext(registries));
  if (checked.kind !== 'imported') return { kind: 'invalid' };
  const { portfolio, site } = checked.unit.models;
  // No media document: no rendition, and no source the content names, reaches the page.
  const view = resolvePortfolioView(
    { portfolio, site: withSelection(site, document.selection) },
    {},
    { mediaBase: '/local-media', extensions: CONTENT_EXTENSIONS },
  );
  const segments = route === '/' ? [] : route.slice(1).split('/');
  const resolved = await resolveVisitorPathIn(
    { segments, basePath: LOCAL_LINK_BASE },
    async () => view,
    registries.variants,
  );
  if (resolved.kind === 'not-found') return { kind: 'not-found' };
  if (resolved.kind === 'redirect') {
    return { kind: 'redirect', route: routeOf(new URL(resolved.location, origin).pathname, LOCAL_LINK_BASE) };
  }
  const { manifest } = resolved.composition.rendered;
  const appearance = resolveDocumentAppearance({
    site: resolved.view.site,
    variant: manifest.id,
    profile: 'demo',
    registry: registries.appearance,
  });
  const input = buildRenderInput({
    view: resolved.view,
    manifest,
    route: resolved.target,
    basePath: LOCAL_LINK_BASE,
    origin,
    requestTime,
  });
  const lang = hostLang(resolved.view.portfolio.locale);
  return {
    kind: 'render',
    input,
    composition: resolved.composition,
    appearance,
    ...(lang ? { lang } : {}),
  };
}

/** A rendered local document: #19's boundary, the variant's and packs' stylesheets, and the variant. */
export function LocalDocumentView({
  render,
  registries,
  Variant,
  nonce,
}: {
  readonly render: Extract<LocalRender, { kind: 'render' }>;
  readonly registries: LocalRegistries;
  readonly Variant: VariantComponent;
  readonly nonce?: string;
}) {
  const stylesheet = registries.variantStylesheet(render.appearance.selection.variant);
  return (
    <>
      {/* Renders nothing: it registers the enhancement loaders and extension renderers. */}
      <ClientHostModules />
      {stylesheet ? (
        <link rel="stylesheet" href={stylesheet} precedence="variant" nonce={nonce} />
      ) : null}
      <PresentationBoundary
        kind="document"
        appearance={render.appearance}
        ids={{ prefix: '', main: render.input.ids.main }}
        stylesheets={registries.stylesheets}
        skipLink={{ label: 'Skip to content', ...(render.lang ? { lang: render.lang } : {}) }}
        {...(nonce ? { nonce } : {})}
      >
        <Variant input={render.input} />
      </PresentationBoundary>
    </>
  );
}

/** What the frame shows when it shows no document. */
function FrameStatus({ text, busy }: { readonly text: string; readonly busy?: boolean }) {
  return (
    <p className="local-preview__status" aria-busy={busy ? true : undefined}>
      {text}
    </p>
  );
}

export interface LocalFrameProps {
  readonly catalog: LocalCatalog;
  /** Studio's origin, the deployment's: the only one the frame says hello to. */
  readonly studioOrigin: string;
  /** The response's CSP nonce, for the stylesheets the frame links. */
  readonly nonce?: string;
  /** Installs the post-pass. Tests pass one that fails. */
  readonly install?: () => Promise<void>;
}

export interface Shown {
  readonly render: Extract<LocalRender, { kind: 'render' }>;
  readonly Variant: VariantComponent;
}

/** The local frame: its channel to Studio, the post-pass, and the document Studio sent. */
export function LocalFrame({ catalog, studioOrigin, nonce, install = installPostPass }: LocalFrameProps) {
  const registries = useMemo(() => localRegistries(catalog), [catalog]);
  const [postPass, setPostPass] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [document, setDocument] = useState<LocalDocumentMessage | null>(null);
  const [route, setRoute] = useState('/');
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);

  // The post-pass first: no document renders before it, or without it.
  useEffect(() => {
    let cancelled = false;
    install().then(
      () => {
        if (!cancelled) setPostPass('ready');
      },
      () => {
        if (cancelled) return;
        setPostPass('failed');
        reportFrameStatus({ state: 'render_failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [install]);

  useEffect(
    () =>
      startFrameChannel(window, {
        mode: 'local',
        studioOrigin,
        linkBase: LOCAL_LINK_BASE,
        renderedVersion: null,
        onDocument: (next) => {
          setDocument(next);
          setRoute('/');
        },
        onRoute: setRoute,
      }) ?? undefined,
    [studioOrigin],
  );

  useEffect(() => {
    if (!document || postPass !== 'ready') return;
    let cancelled = false;
    void renderLocal({ document, route, registries, origin: window.location.origin })
      .then(async (render) => {
        if (cancelled) return;
        if (render.kind === 'redirect') return setRoute(render.route);
        if (render.kind !== 'render') throw new Error(render.kind);
        const load = VARIANT_LOADERS[render.composition.rendered.manifest.id];
        if (!load) throw new Error('unregistered');
        const { default: Variant } = await load();
        if (cancelled) return;
        setShown({ render, Variant });
        setFailed(false);
        reportFrameStatus({ state: 'ready' });
      })
      .catch(() => {
        if (cancelled) return;
        setShown(null);
        setFailed(true);
        reportFrameStatus({ state: 'render_failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [document, route, postPass, registries]);

  const view = frameView(postPass, shown, failed);
  if (view.kind === 'unavailable') return <FrameStatus text="This preview couldn't load." />;
  if (view.kind === 'not-rendered') return <FrameStatus text="This document doesn't render here." />;
  if (view.kind === 'waiting') return <FrameStatus text="Waiting for the document…" busy />;
  return (
    <LocalDocumentView
      render={view.shown.render}
      registries={registries}
      Variant={view.shown.Variant}
      nonce={nonce}
    />
  );
}

/**
 * What the frame shows: a document only once the post-pass is in and the
 * document rendered. Before the post-pass arrives it waits, and if it never
 * does, it shows no document at all, whatever Studio sent.
 */
export function frameView(
  postPass: 'loading' | 'ready' | 'failed',
  shown: Shown | null,
  failed: boolean,
):
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'not-rendered' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'document'; readonly shown: Shown } {
  if (postPass === 'failed') return { kind: 'unavailable' };
  if (postPass !== 'ready') return { kind: 'waiting' };
  if (failed) return { kind: 'not-rendered' };
  if (!shown) return { kind: 'waiting' };
  return { kind: 'document', shown };
}
