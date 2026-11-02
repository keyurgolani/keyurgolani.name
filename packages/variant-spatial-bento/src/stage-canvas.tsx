'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpatialCanvas, useBoundaryColors, useFrame } from '@portfolio/kit/spatial-canvas';
import { sectionRenders } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { boardPlane, boardsOf, overviewOf, overviewPlane } from './model';
import {
  boxEdges,
  buildScene,
  FOOTPRINT,
  onDemand,
  SCENE_ROLES,
  type Scene,
  type SceneRole,
} from './scene';
import { Slot, type StageCanvasProps } from './stage-slot';

// The spatial stage (#16), loaded only once the policy lets it run: the
// Contents tile's planes in three dimensions, one a row, each with a block
// for each of its board's tiles, seen from the same isometric corner the
// still draws them from, so the stage and the still are one picture. Its
// colors are the boundary's, read once and again on an appearance change,
// and it shows nothing the page doesn't: the canvas is hidden from
// assistive technology, takes no pointer or key, and no word is drawn in
// it. This module and the three.js it brings are the stage's own chunk,
// never on the static path.
//
// It renders on demand. The picture changes only when its colors, its
// planes, its size, or the lifted board do, so the canvas runs for the one
// frame each of those needs and then pauses: idle on the page, it asks for
// no frame at all. Pointing at a board's row, or tabbing to it, lifts that
// board's plane, as the still's does.

/** The camera: far and narrow, so the view is all but parallel, as the still's is. */
const CAMERA = { fov: 8, distance: 60 } as const;
/** The isometric corner: a turn of 45 degrees about the vertical, then the tilt that shows the tops. */
const ISOMETRIC: [number, number, number] = [Math.atan(1 / Math.SQRT2), -Math.PI / 4, 0];
/** How much of its row a plane fills. */
const FILL = 1;
/** How far a lifted plane rises, as a share of its row: short of the row above. */
const LIFT = 0.12;

type Colors = Readonly<Record<SceneRole, string | null>>;

/** A box with its top in one role and its two visible sides in the side roles. */
function Block({
  position,
  size,
  top,
  colors,
}: {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly top: SceneRole;
  readonly colors: Colors;
}) {
  const edges = useMemo(() => boxEdges(size), [size]);
  // Faces in three's order: +x, -x, +y, -y, +z, -z.
  const faces: SceneRole[] = [
    'border-default',
    'border-default',
    top,
    'border-subtle',
    'border-subtle',
    'border-subtle',
  ];
  return (
    <mesh position={[...position]}>
      <boxGeometry args={[...size]} />
      {faces.map((role, index) => (
        <meshBasicMaterial
          key={index}
          attach={`material-${index}`}
          color={colors[role] ?? undefined}
          // The boundary's colors as they are, as the still paints them: no tone mapping.
          toneMapped={false}
        />
      ))}
      {/* Its outline, as the still strokes every block: a top the tile's own color still reads. */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={colors['border-default'] ?? undefined} toneMapped={false} />
      </lineSegments>
    </mesh>
  );
}

function Planes({
  scene,
  colors,
  rows,
  lifted,
}: {
  scene: Scene;
  colors: Colors;
  rows: number;
  lifted: number | null;
}) {
  // The visible height at the planes' distance, in scene units, and a row of it.
  const height = 2 * CAMERA.distance * Math.tan((CAMERA.fov * Math.PI) / 360);
  const row = height / Math.max(rows, 1);
  // A footprint's drawn height, isometric: its width and depth each rise sin 30 degrees, scaled by the view.
  const scale = (row * FILL) / ((FOOTPRINT.width + FOOTPRINT.depth) * 0.41);
  const { width, depth, slab } = FOOTPRINT;
  return (
    <>
      {scene.planes.map((plane, index) => (
        <group
          key={index}
          position={[0, height / 2 - row * (index + 0.5) + (lifted === index ? row * LIFT : 0), 0]}
        >
          <group rotation={ISOMETRIC} scale={scale}>
            <group position={[-width / 2, 0, -depth / 2]}>
              <Block
                position={[width / 2, -slab / 2, depth / 2]}
                size={[width, slab, depth]}
                top={plane.raised ? 'canvas' : 'surface-subtle'}
                colors={colors}
              />
              {plane.blocks.map((block, k) => (
                <Block
                  key={k}
                  position={[
                    block.x + block.width / 2,
                    block.height / 2,
                    block.z + block.depth / 2,
                  ]}
                  size={[block.width, block.height, block.depth]}
                  top={block.top}
                  colors={colors}
                />
              ))}
            </group>
          </group>
        </group>
      ))}
    </>
  );
}

/** Reports, from inside the scene, each frame drawn of the picture's version. */
function Drawn({ version, onDrawn }: { version: object; onDrawn: (version: object) => void }) {
  useFrame(() => onDrawn(version));
  return null;
}

/** The index of the Contents row a pointer is on or focus is in, from the stage's body. */
function useLifted(frame: { readonly current: HTMLDivElement | null }): number | null {
  const [lifted, setLifted] = useState<number | null>(null);
  useEffect(() => {
    const body = frame.current?.closest('.sb-stage__body');
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>('.sb-contents__row'));
    const at = (event: Event) => {
      const row = (event.target as Element | null)?.closest?.('.sb-contents__row');
      const index = row ? rows.indexOf(row as HTMLElement) : -1;
      setLifted(index >= 0 ? index : null);
    };
    const off = () => setLifted(null);
    for (const row of rows) {
      row.addEventListener('pointerenter', at);
      row.addEventListener('pointerleave', off);
      row.addEventListener('focusin', at);
      row.addEventListener('focusout', off);
    }
    return () => {
      for (const row of rows) {
        row.removeEventListener('pointerenter', at);
        row.removeEventListener('pointerleave', off);
        row.removeEventListener('focusin', at);
        row.removeEventListener('focusout', off);
      }
    };
  }, [frame]);
  return lifted;
}

export function StageCanvas({ state, models, onFailure, onFirstFrame }: StageCanvasProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const colors = useBoundaryColors(frame, SCENE_ROLES);
  const scene = useMemo(() => buildScene(models ?? []), [models]);
  const lifted = useLifted(frame);
  // A resize clears the canvas, so each one is a new picture to draw.
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => setResized((n) => n + 1));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  // The picture: a new one whenever anything it shows changes, and the last one drawn.
  const version = useMemo(
    () => ({ colors, scene, lifted, resized }),
    [colors, scene, lifted, resized],
  );
  const [drawn, setDrawn] = useState<object | null>(null);
  const onDrawn = useCallback((shown: object) => {
    setDrawn((current) => (current === shown ? current : shown));
  }, []);
  return (
    <div ref={frame} className="sb-still__canvas">
      <SpatialCanvas
        state={onDemand(state, version, drawn)}
        onFailure={onFailure}
        onFirstFrame={onFirstFrame}
        // A slow device's first frame is still a first frame: only none at all is a failure.
        firstFrameMs={8000}
        camera={{ fov: CAMERA.fov, position: [0, 0, CAMERA.distance] }}
      >
        {colors ? (
          <>
            <Planes scene={scene} colors={colors} rows={scene.planes.length} lifted={lifted} />
            <Drawn version={version} onDrawn={onDrawn} />
          </>
        ) : null}
      </SpatialCanvas>
    </div>
  );
}

/** The planes the Contents tile draws for this render: the overview's, then each board's. */
export function stageModels(input: VariantRenderInput) {
  const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
  const overview = overviewOf(sections, input);
  return [overviewPlane(overview), ...boardsOf(sections, overview, input).map(boardPlane)];
}

/**
 * The stage as the manifest declares it, the `stage` enhancement, so
 * check:budgets charges this chunk with everything in it, three and R3F
 * included. The Contents tile's slot loads it, through StageCanvas, only
 * once the policy lets the stage run. What an EnhancementIsland would mount
 * is the whole slot, so the policy, the one stage a document, the exit, and
 * the teardown hold however the stage comes to load.
 */
export default function StageEnhancement({ input }: { readonly input: VariantRenderInput }) {
  return (
    <Slot
      seed={input.env.seed}
      idPrefix={input.ids.prefix}
      Canvas={StageCanvas}
      models={stageModels(input)}
    />
  );
}
