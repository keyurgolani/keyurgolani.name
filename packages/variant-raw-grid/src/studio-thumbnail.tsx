import { Box, Headline, mix, tint, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The exposed grid: its columns ruled under everything, the ticker strip, the bar of ruled
// cells, then the poster cell with the name, its stickers and the two actions, and beside
// it the practice cell under its black tape and the signature work's plate.
const thumbnail: StudioThumbnail = (p) => {
  const poster = mix(p.canvas, p.text, 0.08);
  const plate = mix(p.secondary, p.text, 0.55);
  const heavy = 0.5;
  const cell = (x: number, y: number, w: number, h: number) => (
    <rect x={x} y={y} width={w} height={h} fill="none" stroke={p.text} strokeWidth={heavy} />
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((at) => (
        <Box key={at} x={3.8 + at * 10.7} y={5} w={0.3} h={80} fill={p.rule} />
      ))}
      {[0, 1, 2, 3].map((at) => (
        <g key={at}>
          <Box x={1 + at * 29} y={1.9} w={at % 2 ? 17 : 12} h={1.2} fill={p.strong} rx={0.3} />
          <Box x={(at % 2 ? 20 : 15) + at * 29} y={2.1} w={0.8} h={0.8} fill={p.strong} />
        </g>
      ))}
      <Box x={118} y={0} w={18} h={5} fill={p.canvas} />
      <Box x={118} y={0} w={heavy} h={5} fill={p.text} />
      <Box x={121} y={1.9} w={1.2} h={1.2} fill={p.text} />
      <Box x={123.6} y={1.9} w={9} h={1.2} fill={p.text} rx={0.3} />
      <Box x={0} y={4.9} w={136} h={heavy} fill={p.text} />
      <Box x={3.8} y={5.2} w={128.4} h={5} fill={p.canvas} />
      {cell(3.8, 5.2, 128.4, 5)}
      {[36, 46.6, 57.3, 68, 78.7, 89.4, 121.4].map((x) => (
        <Box key={x} x={x} y={5.2} w={heavy} h={5} fill={p.text} />
      ))}
      <Box x={6} y={7} w={9.5} h={1.4} fill={p.text} rx={0.3} />
      {[36, 46.6, 57.3, 68, 78.7].map((x) => (
        <g key={x}>
          <Box x={x + 2} y={7.1} w={4.2} h={1.2} fill={p.text} rx={0.3} />
          <Box x={x + 7.6} y={7.1} w={0.8} h={1.2} fill={p.strong} />
        </g>
      ))}
      <Box x={91.6} y={7.1} w={14} h={1.2} fill={p.strong} rx={0.3} />
      {[0, 1, 2].map((at) => (
        <Box key={at} x={123.4} y={6.6 + at * 0.9} w={1.8} h={0.4} fill={p.text} />
      ))}
      <Box x={126.2} y={6.9} w={4.4} h={1.6} fill={p.text} rx={0.3} />
      <Box x={3.8} y={12.5} w={85.5} h={71.3} fill={poster} />
      <Box x={7.8} y={16.4} w={20} h={1.3} fill={p.text} rx={0.3} />
      <Box x={7.8} y={19.3} w={5} h={1} fill={p.muted} rx={0.3} />
      <Box x={14.4} y={19.3} w={10} h={1} fill={p.muted} rx={0.3} />
      <Headline x={7.8} y={31} size={10} fill={p.text} w={30} />
      <Headline x={7.8} y={39} size={10} fill={p.text} w={15} />
      {cell(7.8, 42.6, 36, 19.4)}
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={10.8}
          y={45.6 + at * 2}
          w={at === 2 ? 22 : 29}
          h={1.2}
          fill={p.text}
          rx={0.3}
        />
      ))}
      <Box x={10.8} y={52.3} w={30} h={0.3} fill={p.strong} />
      <Box x={10.8} y={54.6} w={28} h={1.2} fill={p.strong} rx={0.3} />
      <Box x={10.8} y={57.1} w={21} h={1.2} fill={p.strong} rx={0.3} />
      <g transform="rotate(-4 71 26.5)">
        <rect x={57.2} y={22.4} width={28} height={8.2} rx={4.1} fill={p.text} />
        <Box x={61.5} y={25} w={19.5} h={1.3} fill={p.canvas} rx={0.3} />
        <Box x={67.3} y={27.3} w={7.4} h={1} fill={p.canvas} rx={0.3} />
      </g>
      <g transform="rotate(3 68 47)">
        <rect
          x={56.8}
          y={43.4}
          width={22.6}
          height={7}
          rx={3.5}
          fill={p.canvas}
          stroke={p.text}
          strokeWidth={heavy}
        />
        <Box x={61.5} y={45.6} w={9} h={1.2} fill={p.text} rx={0.3} />
        <Box x={60} y={47.8} w={16} h={1} fill={p.strong} rx={0.3} />
      </g>
      <g transform="rotate(-3 70.6 69)">
        <rect
          x={56}
          y={64.7}
          width={29}
          height={8.6}
          rx={4.3}
          fill={p.canvas}
          stroke={p.text}
          strokeWidth={heavy}
        />
        <Box x={63} y={67.3} w={15} h={1.2} fill={p.text} rx={0.3} />
        <Box x={64} y={70} w={12.6} h={1} fill={p.strong} rx={0.3} />
      </g>
      <Box x={7.8} y={75.2} w={17} h={4.6} fill={p.accent} />
      {cell(7.8, 75.2, 17, 4.6)}
      <Box x={11.5} y={76.9} w={9.6} h={1.3} fill={p.text} rx={0.3} />
      <Box x={26.8} y={75.2} w={15.5} h={4.6} fill={p.canvas} />
      {cell(26.8, 75.2, 15.5, 4.6)}
      <Box x={30.4} y={76.9} w={5.5} h={1.3} fill={p.text} rx={0.3} />
      <Box x={37.5} y={76.9} w={1.4} h={1.3} fill={p.strong} />
      {cell(3.8, 12.5, 85.5, 71.3)}
      <Box x={89.3} y={12.5} w={42.9} h={71.3} fill={p.canvas} />
      {cell(89.3, 12.5, 42.9, 71.3)}
      <Box x={89.3} y={42.8} w={42.9} h={heavy} fill={p.text} />
      <Box x={89.3} y={12.5} w={9.8} h={3.6} fill={p.text} />
      <Box x={91} y={13.7} w={6.4} h={1.2} fill={p.canvas} rx={0.3} />
      <Headline x={92.3} y={23} size={5.6} fill={p.text} w={31} />
      <Headline x={92.3} y={29} size={5.6} fill={p.text} w={17.5} />
      {[0, 1, 2, 3].map((at) => (
        <Box
          key={at}
          x={92.3}
          y={31.6 + at * 2.4}
          w={at === 3 ? 13 : 36}
          h={1.1}
          fill={p.strong}
          rx={0.3}
        />
      ))}
      <Box x={92.3} y={52.5} w={36.7} h={18.3} fill={plate} />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={100.5 + at * 2.1}
          y={54.4 + at * 1}
          width={13}
          height={15.6 - at * 1}
          rx={0.6}
          fill={tint(p.canvas, 0.4 + at * 0.15)}
          opacity={0.6 + at * 0.13}
        />
      ))}
      {[0, 1, 2, 3, 4].map((at) => (
        <Box key={at} x={108.6} y={57.6 + at * 2.2} w={9.6} h={0.4} fill={p.muted} />
      ))}
      {cell(92.3, 52.5, 36.7, 18.3)}
      <Box x={92.3} y={72.6} w={9.4} h={1} fill={p.muted} rx={0.3} />
      <Box x={92.3} y={75.3} w={19.5} h={1.3} fill={p.text} rx={0.3} />
      <Box x={92.3} y={77} w={19.5} h={0.35} fill={p.accent} />
      <Box x={92.3} y={79.2} w={1.4} h={1.2} fill={p.text} />
      <Box x={94.6} y={79.2} w={13} h={1.2} fill={p.strong} rx={0.3} />
    </>
  );
};

export default thumbnail;
