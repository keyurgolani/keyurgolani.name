import {
  Box,
  Headline,
  mix,
  shade,
  tint,
  type StudioThumbnail,
} from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The first view under its sky: the sky a soft fall from the accent through the secondary to
// the canvas, in bands, since a drawing many pickers share takes no gradient ids, the dunes
// across its foot, the frosted capsule of the navigation near the top, the frosted hero pane
// with the name and the headline, the call to action as the one accent pill and the glance
// chips under it, two glass orbs, and the signature sheet's corner standing at the bottom right.
const thumbnail: StudioThumbnail = (p) => {
  const BANDS = 28;
  const sky = (at: number) => {
    const t = at / (BANDS - 1);
    const hue =
      t < 0.5 ? mix(p.accent, p.secondary, t * 2) : mix(p.secondary, p.canvas, (t - 0.5) * 2);
    return mix(hue, p.canvas, 0.35);
  };
  // Frost is the canvas itself over the sky, so it's pale glass in light and smoked in dark.
  const frost = p.canvas;
  const glass = mix(p.canvas, p.text, 0.08);
  const night = shade(p.secondary, 0.55);
  return (
    <>
      {Array.from({ length: BANDS }, (_, at) => (
        <Box key={at} x={0} y={at * (70 / BANDS)} w={136} h={70 / BANDS + 0.4} fill={sky(at)} />
      ))}
      <path d="M0 64C24 58 44 61 70 64S112 62 136 58V85H0Z" fill={mix(night, p.canvas, 0.2)} />
      <path d="M0 74C30 68 56 72 84 75S120 72 136 70V85H0Z" fill={mix(p.accent, p.text, 0.25)} />
      <rect x={30} y={3} width={76} height={7} rx={3.5} fill={frost} opacity={0.88} />
      <Box x={35} y={5.7} w={11} h={1.6} fill={p.text} rx={0.8} />
      {[52, 61, 70, 79].map((x) => (
        <Box key={x} x={x} y={5.9} w={6} h={1.2} fill={p.strong} rx={0.6} />
      ))}
      <Box x={90} y={4.6} w={13} h={3.8} fill={p.strong} rx={1.9} />
      <rect x={6} y={14} width={76} height={64} rx={4} fill={frost} opacity={0.86} />
      <Box x={10} y={14.6} w={68} h={0.5} fill={tint(p.canvas, 0.5)} rx={0.25} />
      <Box x={11} y={18.6} w={20} h={1.2} fill={p.strong} rx={0.6} />
      <Box x={60} y={18.6} w={17} h={1.2} fill={p.strong} rx={0.6} />
      <Box x={11} y={22.6} w={9} h={1.1} fill={p.muted} rx={0.55} />
      <Box x={11} y={25.4} w={18} h={1.8} fill={p.text} rx={0.9} />
      <Headline x={10.5} y={36} size={11} fill={p.text} w={46} />
      <Headline x={10.5} y={46} size={11} fill={p.text} w={29} />
      {[50.5, 53.3, 56.1].map((y, at) => (
        <Box key={y} x={11} y={y} w={at === 2 ? 26 : 42} h={1.2} fill={p.muted} rx={0.6} />
      ))}
      <Box x={11} y={60.4} w={15} h={4.6} fill={p.accent} rx={2.3} />
      <Box x={29} y={62} w={8} h={1.2} fill={p.strong} rx={0.6} />
      {[11, 33, 55].map((x) => (
        <g key={x}>
          <rect x={x} y={68} width={20} height={7} rx={2} fill={glass} opacity={0.8} />
          <Box x={x + 2} y={69.6} w={6} h={2} fill={p.secondary} rx={0.6} />
          <Box x={x + 2} y={72.6} w={13} h={0.9} fill={p.muted} rx={0.45} />
        </g>
      ))}
      <circle cx={94} cy={27} r={6} fill={tint(p.accent, 0.35)} opacity={0.75} />
      <circle cx={92.2} cy={25.2} r={1.8} fill={tint(p.canvas, 0.7)} opacity={0.8} />
      <circle cx={107} cy={29} r={3.6} fill={tint(p.secondary, 0.4)} opacity={0.75} />
      <rect x={87} y={38} width={45} height={47} rx={3} fill={mix(p.canvas, p.text, 0.04)} />
      <path d="M87 41a3 3 0 0 1 3 -3h39a3 3 0 0 1 3 3v19h-45z" fill={night} />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={96 + at * 3}
          y={42 + at * 2}
          width={20}
          height={15}
          rx={0.8}
          fill={tint(p.canvas, 0.3 + at * 0.15)}
          opacity={0.7 + at * 0.1}
        />
      ))}
      <Box x={91} y={64} w={20} h={1} fill={p.muted} rx={0.5} />
      <Box x={91} y={67} w={26} h={2} fill={p.text} rx={1} />
      <Box x={91} y={71.4} w={34} h={1} fill={p.strong} rx={0.5} />
      <Box x={91} y={74} w={28} h={1} fill={p.strong} rx={0.5} />
      <Box x={91} y={77.4} w={14} h={1.1} fill={p.accent} rx={0.55} />
    </>
  );
};

export default thumbnail;
