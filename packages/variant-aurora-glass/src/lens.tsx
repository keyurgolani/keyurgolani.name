import { ownId } from './parts';

// The Lens (brief §5.2, step 2; AG-S1; N8): two glass beads in the open sky
// at the h1's right side, inline SVG, aria-hidden. They're glass, not goo
// (goo is Flux's): each a near-clear fill from the sky's own roles, a
// darker refracting band near the rim, a specular highlight, and a rim
// line. They bridge rather than ooze: the small bead breathes away from the
// large one and back over one cycle, a third of the sky's ambient cycle
// (K-4 b). Its first frame, which every still state holds (no script,
// reduced motion, a static page, Pause), is the bridge: the two touching.

export function Lens({ prefix }: { prefix: string }) {
  const a = ownId(prefix, 'bead-a');
  const b = ownId(prefix, 'bead-b');
  const shine = ownId(prefix, 'bead-shine');
  return (
    <div className="ag-lens" aria-hidden="true">
      <svg className="ag-lens__svg" viewBox="0 0 320 180" focusable="false">
        <defs>
          <radialGradient id={a} cx="0.5" cy="0.5" r="0.5" fx="0.4" fy="0.36">
            <stop className="ag-lens__a0" offset="0" />
            <stop className="ag-lens__a1" offset="0.62" />
            <stop className="ag-lens__a2" offset="0.9" />
            <stop className="ag-lens__a3" offset="1" />
          </radialGradient>
          <radialGradient id={b} cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.36">
            <stop className="ag-lens__b0" offset="0" />
            <stop className="ag-lens__b1" offset="0.62" />
            <stop className="ag-lens__b2" offset="0.9" />
            <stop className="ag-lens__b3" offset="1" />
          </radialGradient>
          <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
            <stop className="ag-lens__shine0" offset="0" />
            <stop className="ag-lens__shine1" offset="1" />
          </linearGradient>
        </defs>
        <g className="ag-lens__bead ag-lens__bead--a">
          <circle className="ag-lens__body" cx="112" cy="90" r="62" fill={`url(#${a})`} />
          <ellipse
            className="ag-lens__shine"
            cx="92"
            cy="60"
            rx="24"
            ry="13"
            transform="rotate(-28 92 60)"
            fill={`url(#${shine})`}
          />
          <circle className="ag-lens__rim" cx="112" cy="90" r="61" />
        </g>
        <g className="ag-lens__bead ag-lens__bead--b">
          <circle className="ag-lens__body" cx="206" cy="94" r="40" fill={`url(#${b})`} />
          <ellipse
            className="ag-lens__shine"
            cx="194"
            cy="76"
            rx="14"
            ry="8"
            transform="rotate(-28 194 76)"
            fill={`url(#${shine})`}
          />
          <circle className="ag-lens__rim" cx="206" cy="94" r="39" />
        </g>
      </svg>
    </div>
  );
}
