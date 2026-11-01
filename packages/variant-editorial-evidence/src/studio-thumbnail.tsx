import { Box, Headline, mix, tint, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The concept's front page: a running head, the headline across the measure, then an index
// with its numbers, a rule, the plate, and the notes column.
const thumbnail: StudioThumbnail = (p) => {
  const plate = mix(p.secondary, p.text, 0.55);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <Box x={6} y={4} w={18} h={2} fill={p.text} rx={1} />
      <Box x={38} y={4} w={3} h={2} fill={p.accent} />
      <Box x={43} y={4} w={14} h={2} fill={p.strong} rx={1} />
      <Box x={98} y={4} w={14} h={2} fill={p.text} rx={1} />
      <Box x={116} y={4} w={14} h={2} fill={p.accent} rx={1} />
      <Box x={0} y={9} w={136} h={0.6} fill={p.rule} />
      <Headline x={5} y={26} size={19} fill={p.text} w={126} />
      {[0, 1, 2, 3, 4].map((at) => (
        <g key={at}>
          <Box x={6} y={34 + at * 8} w={1.6} h={2} fill={p.accent} />
          <Box
            x={10}
            y={34 + at * 8}
            w={at === 0 ? 14 : 11}
            h={2}
            fill={at === 0 ? p.text : p.strong}
            rx={1}
          />
          <Box x={10} y={37.2 + at * 8} w={16} h={1.2} fill={p.muted} rx={0.6} />
        </g>
      ))}
      <Box x={31} y={33} w={0.6} h={42} fill={p.rule} />
      <Box x={35} y={33} w={58} h={41} fill={plate} rx={2.5} />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={45 + at * 4}
          y={41 + at * 4}
          width={28}
          height={22}
          rx={1.5}
          fill={tint(p.canvas, 0.4 + at * 0.15)}
          opacity={0.55 + at * 0.15}
        />
      ))}
      {[0, 1, 2, 3, 4].map((at) => (
        <Box key={at} x={62} y={53 + at * 3} w={20} h={0.8} fill={p.muted} />
      ))}
      {[0, 1, 2, 3, 4].map((at) => (
        <Box
          key={at}
          x={97}
          y={34 + at * 3.4}
          w={at === 4 ? 22 : 33}
          h={1.6}
          fill={p.strong}
          rx={0.8}
        />
      ))}
      <Box x={97} y={53} w={26} h={1.4} fill={p.text} rx={0.7} />
      <Box x={97} y={56.5} w={33} h={1.2} fill={p.muted} rx={0.6} />
      {[62, 66.5, 71].map((y) => (
        <g key={y}>
          <Box x={97} y={y - 1.2} w={33} h={0.5} fill={p.rule} />
          <Box x={97} y={y} w={28} h={1.2} fill={p.muted} rx={0.6} />
        </g>
      ))}
      <Box x={0} y={77} w={136} h={0.6} fill={p.rule} />
      {[6, 38, 70, 102].map((x) => (
        <Box key={x} x={x} y={80} w={18} h={1.4} fill={p.strong} rx={0.7} />
      ))}
    </>
  );
};

export default thumbnail;
