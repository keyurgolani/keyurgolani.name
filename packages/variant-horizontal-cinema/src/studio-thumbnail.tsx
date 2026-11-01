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
// The strip: a frame between black mattes, its title card light, the next frame peeking
// in at the right edge, and the segmented scrubber under them.
const thumbnail: StudioThumbnail = (p) => {
  const matte = shade(p.text, 0.7);
  const plate = mix(p.secondary, p.text, 0.55);
  const light = mix(p.canvas, matte, 0.12);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <Box x={5} y={2.6} w={14} h={1.6} fill={p.text} rx={0.8} />
      <Box x={21} y={2.8} w={16} h={1.2} fill={p.strong} rx={0.6} />
      <rect x={104} y={1.6} width={14} height={4} rx={1.2} fill={mix(p.canvas, p.text, 0.08)} />
      <Box x={122} y={2.8} w={10} h={1.2} fill={p.accent} rx={0.6} />
      <rect x={3} y={8} width={91} height={64} rx={2.5} fill={matte} />
      <Box x={3} y={22} w={91} h={30} fill={p.canvas} />
      <Box x={7} y={11} w={8} h={1.2} fill={light} rx={0.6} />
      <Box x={79} y={11} w={11} h={1.2} fill={light} rx={0.6} />
      <Box x={7} y={26} w={14} h={1.1} fill={p.strong} rx={0.5} />
      <Box x={77} y={26} w={13} h={1.1} fill={p.strong} rx={0.5} />
      <Headline x={7} y={44} size={19} fill={p.text} />
      <rect x={36} y={48} width={10} height={3} rx={0.8} fill={p.text} />
      <rect
        x={48}
        y={48}
        width={9}
        height={3}
        rx={0.8}
        fill="none"
        stroke={p.text}
        strokeWidth={0.4}
      />
      <Box x={14} y={57} w={70} h={1.8} fill={light} rx={0.9} />
      <Box x={22} y={61} w={54} h={1.4} fill={mix(light, matte, 0.35)} rx={0.7} />
      <Box x={7} y={67.5} w={30} h={1} fill={mix(light, matte, 0.35)} rx={0.5} />
      <rect x={97} y={8} width={42} height={64} rx={2.5} fill={p.surface} />
      <Box x={97} y={8} w={42} h={4.5} fill={matte} />
      <Box x={100} y={9.6} w={10} h={1.2} fill={light} rx={0.6} />
      <Box x={100} y={15} w={36} h={30} fill={plate} />
      {[0, 1, 2].map((at) => (
        <rect
          key={at}
          x={110 + at * 4}
          y={20 + at * 3}
          width={22}
          height={18}
          rx={1}
          fill={tint(p.canvas, 0.5 + at * 0.15)}
          opacity={0.7 + at * 0.1}
        />
      ))}
      <Box x={100} y={48} w={36} h={1.6} fill={p.text} rx={0.8} />
      <Box x={100} y={51.6} w={30} h={1.6} fill={p.text} rx={0.8} />
      <Box x={100} y={56} w={22} h={1.1} fill={p.strong} rx={0.5} />
      <Box x={97} y={66} w={42} h={6} fill={matte} />
      <Box x={0} y={74} w={136} h={0.5} fill={p.rule} />
      <rect
        x={4}
        y={77}
        width={6}
        height={5.5}
        rx={1.2}
        fill="none"
        stroke={p.strong}
        strokeWidth={0.5}
      />
      <rect
        x={12}
        y={77}
        width={6}
        height={5.5}
        rx={1.2}
        fill="none"
        stroke={p.text}
        strokeWidth={0.6}
      />
      {[
        [22, 4],
        [46, 4],
        [68, 6],
        [96, 5],
        [118, 3],
      ].map(([x, count], group) => (
        <g key={x}>
          <Box x={x!} y={76.4} w={8} h={1} fill={p.strong} rx={0.5} />
          {Array.from({ length: count! }, (_, at) => (
            <rect
              key={at}
              x={x! + at * 4.4}
              y={79}
              width={4}
              height={2.6}
              rx={0.4}
              fill={group === 0 && at === 0 ? p.accent : group > 0 && at === 0 ? p.text : 'none'}
              stroke={p.strong}
              strokeWidth={0.3}
            />
          ))}
        </g>
      ))}
    </>
  );
};

export default thumbnail;
