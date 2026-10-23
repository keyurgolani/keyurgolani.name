'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppearanceSelection } from '@portfolio/schema';
import { VIEWPORTS } from '~/lib/preview-frame';
import {
  createPreviewScheduler,
  type PlateTier,
  type PreviewScheduler,
} from '~/lib/studio/preview-scheduler';
import type { MintRequest } from '../preview/grant-session';
import { PreviewSurface } from '../preview/preview-surface';

// The catalog plates (#6, item 5), for #8 and #9 to adopt: each a variant's
// committed still, the first eager and the rest lazy, as a plain <img> with
// its width and height, and a live #7 preview in its place only while the
// scheduler says so, on the visitor's request or a prefetch within a
// viewport of the screen. The plate mounts PreviewSurface while it's live
// and unmounts it, back to the still, once it isn't, so a frame, its grant,
// and its channel exist only for a live plate. Offscreen, a live frame goes
// `hidden` through PreviewSurface's own lifecycle, which pauses #6's
// runtime inside it.

export interface CatalogStill {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface CatalogPlate {
  readonly id: string;
  readonly name: string;
  readonly tier: PlateTier;
  /** The variant's committed stills, the largest first. */
  readonly stills: readonly CatalogStill[];
}

export interface CatalogPlatesProps {
  readonly plates: readonly CatalogPlate[];
  readonly csrfToken: string;
  /** What every live frame previews: the published revision. */
  readonly subject: MintRequest['subject'];
  /** The appearance the revision selects, each plate's override starting from it. */
  readonly appearance: AppearanceSelection | null;
  readonly sandbox: string;
  readonly previewOrigin: string | null;
  readonly signIn: string;
}

const DESKTOP = VIEWPORTS[0]!;

/** The still a plate shows: the smallest, with every one in its srcset. */
function stillOf(stills: readonly CatalogStill[]) {
  const smallest = [...stills].sort((a, b) => a.width - b.width)[0];
  if (!smallest) return null;
  return {
    ...smallest,
    srcSet: stills.map(({ url, width }) => `${url} ${width}w`).join(', '),
  };
}

function Plate({
  plate,
  first,
  scheduler,
  props,
}: {
  plate: CatalogPlate;
  first: boolean;
  scheduler: PreviewScheduler;
  props: CatalogPlatesProps;
}) {
  const root = useRef<HTMLElement | null>(null);
  const live = useSyncExternalStore(
    scheduler.subscribe,
    () => scheduler.liveFor(plate.id),
    () => null,
  );

  useEffect(() => scheduler.register(plate.id, plate.tier), [scheduler, plate.id, plate.tier]);

  // Within a viewport of the screen, a prefetch may take a live slot.
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) scheduler.setNear(plate.id, entry.isIntersecting);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scheduler, plate.id]);

  const still = stillOf(plate.stills);
  const request: MintRequest = {
    subject: props.subject,
    environment: { displayMode: 'system', contrast: 'system', motion: 'system', enhancement: 'on' },
    ...(props.appearance ? { appearance: { ...props.appearance, variant: plate.id } } : {}),
  };
  return (
    <figure
      ref={root}
      className="catalog-plate"
      data-plate={plate.id}
      data-plate-tier={plate.tier}
      data-plate-live={live ?? 'still'}
    >
      {live ? (
        <PreviewSurface
          name={`${plate.name} preview`}
          csrfToken={props.csrfToken}
          request={request}
          sandbox={props.sandbox}
          previewOrigin={props.previewOrigin}
          viewport={DESKTOP}
          title={`Live revision, ${plate.name}, desktop`}
          refresh={0}
          signIn={props.signIn}
        />
      ) : still ? (
        // eslint-disable-next-line @next/next/no-img-element -- committed stills, already sized; there's no image optimizer
        <img
          className="catalog-plate__still"
          src={still.url}
          srcSet={still.srcSet}
          sizes="(min-width: 960px) 45vw, 90vw"
          width={still.width}
          height={still.height}
          alt={`${plate.name}, as it first renders`}
          loading={first ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <p className="catalog-plate__placeholder">{plate.name} ships no still.</p>
      )}
      <figcaption className="catalog-plate__caption">
        {plate.name}{' '}
        <button
          type="button"
          aria-pressed={live === 'request'}
          onClick={() =>
            live === 'request' ? scheduler.release(plate.id) : scheduler.request(plate.id)
          }
        >
          Live preview
        </button>
      </figcaption>
    </figure>
  );
}

export function CatalogPlates(props: CatalogPlatesProps) {
  const [scheduler] = useState(createPreviewScheduler);
  return (
    <div className="catalog-plates">
      {props.plates.map((plate, index) => (
        <Plate
          key={plate.id}
          plate={plate}
          first={index === 0}
          scheduler={scheduler}
          props={props}
        />
      ))}
    </div>
  );
}
