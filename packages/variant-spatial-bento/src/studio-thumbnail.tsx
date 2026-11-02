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
// The mosaic: an ink hero board with the headline, the Contents board of stacked planes
// beside it, Now and the glance on the right, then the plate, the dark board of bars,
// and the accent board below.
const thumbnail: StudioThumbnail = (p) => {
  const ground = mix(p.canvas, p.text, 0.08);
  const ink = shade(p.text, 0.1);
  const plate = mix(p.secondary, p.text, 0.55);
  const light = mix(p.canvas, ink, 0.08);
  const plane = (x: number, y: number, dark: boolean) => (
    <path
      d={`M${x} ${y + 2}l5 -2.2l5 2.2l-5 2.2z`}
      fill={dark ? ink : p.canvas}
      stroke={mix(p.canvas, p.text, 0.35)}
      strokeWidth={0.3}
    />
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={ground} />
      <Box x={3} y={3} w={61} h={41} fill={ink} rx={3.5} />
      <Box x={7} y={7} w={14} h={1.4} fill={light} rx={0.7} />
      <Box x={23} y={7} w={12} h={1.2} fill={mix(light, ink, 0.4)} rx={0.6} />
      <Headline x={6} y={24} size={13} fill={light} />
      {[0, 1].map((at) => (
        <Box
          key={at}
          x={7}
          y={29 + at * 2.8}
          w={at === 1 ? 30 : 40}
          h={1.2}
          fill={mix(light, ink, 0.3)}
          rx={0.6}
        />
      ))}
      <rect x={7} y={36} width={11} height={4} rx={1} fill={light} />
      <rect
        x={20}
        y={36}
        width={11}
        height={4}
        rx={1}
        fill="none"
        stroke={light}
        strokeWidth={0.4}
      />
      <Box x={66} y={3} w={31} h={41} fill={p.surface} rx={3.5} />
      <Box x={69} y={7} w={12} h={1.6} fill={p.text} rx={0.8} />
      {[0, 1, 2, 3, 4, 5].map((at) => (
        <g key={at}>
          <Box x={69} y={12 + at * 5} w={9} h={1.2} fill={at === 0 ? p.accent : p.text} rx={0.6} />
          {plane(84, 10.5 + at * 5, at % 2 === 0)}
        </g>
      ))}
      <Box x={99} y={3} w={34} h={23} fill={p.surface} rx={3.5} />
      <Box x={102} y={6.5} w={8} h={1.6} fill={p.text} rx={0.8} />
      {[0, 1, 2, 3].map((at) => (
        <Box
          key={at}
          x={102}
          y={11 + at * 3}
          w={at === 3 ? 18 : 27}
          h={1.1}
          fill={p.strong}
          rx={0.55}
        />
      ))}
      <Box x={99} y={28} w={34} h={16} fill={p.surface} rx={3.5} />
      <Box x={102} y={31} w={13} h={1.4} fill={p.text} rx={0.7} />
      {[35, 38, 41].map((y) => (
        <g key={y}>
          <Box x={102} y={y} w={12} h={1} fill={p.strong} rx={0.5} />
          <Box x={127} y={y} w={3} h={1} fill={p.text} rx={0.5} />
        </g>
      ))}
      <Box x={3} y={46} w={52} h={36} fill={plate} rx={3.5} />
      {[0, 1, 2].map((at) => (
        <rect
          key={at}
          x={13 + at * 4}
          y={50 + at * 3}
          width={24}
          height={20}
          rx={1}
          fill={tint(p.canvas, 0.5 + at * 0.15)}
          opacity={0.7 + at * 0.1}
        />
      ))}
      <Box x={6} y={60} w={26} h={19} fill={p.canvas} rx={1.5} />
      <Box x={9} y={64} w={16} h={1.6} fill={p.text} rx={0.8} />
      <Box x={9} y={68} w={19} h={1.1} fill={p.strong} rx={0.5} />
      <rect x={9} y={73} width={9} height={3.4} rx={0.8} fill={ink} />
      <Box x={57} y={46} w={40} h={36} fill={ink} rx={3.5} />
      {[
        [62, 49, 10],
        [71, 53, 14],
        [60, 57, 22],
        [60, 61, 34],
      ].map(([x, y, w]) => (
        <Box key={`${x}${y}`} x={x!} y={y!} w={w!} h={2.6} fill={p.accent} />
      ))}
      <Box x={60} y={68} w={18} h={1.6} fill={light} rx={0.8} />
      <Box x={60} y={72} w={30} h={1.1} fill={mix(light, ink, 0.35)} rx={0.5} />
      <Box x={99} y={46} w={34} h={17} fill={p.surface} rx={3.5} />
      <Box x={102} y={49.5} w={20} h={1.6} fill={p.text} rx={0.8} />
      <Box x={102} y={53.5} w={27} h={1.1} fill={p.strong} rx={0.5} />
      <Box x={102} y={56.5} w={22} h={1.1} fill={p.strong} rx={0.5} />
      <Box x={99} y={65} w={34} h={17} fill={p.accent} rx={3.5} />
      <circle cx={107} cy={73.5} r={4.6} fill="none" stroke={ink} strokeWidth={0.6} />
      <path d="M107 73.5v-2.8M107 73.5l2 1.2" stroke={ink} strokeWidth={0.6} />
      <Box x={115} y={70} w={13} h={1.6} fill={ink} rx={0.8} />
      <Box x={115} y={74} w={10} h={1.1} fill={ink} rx={0.5} />
    </>
  );
};

export default thumbnail;
