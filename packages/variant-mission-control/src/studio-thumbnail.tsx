import { Box, Headline, mix, shade, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The console wall as its first view stands: the board rail down the left edge with its
// mark and board icons, the status line across the top with its two lit readings, then the
// wall's panels, each a title bar over hairline-split cells: the anchor with its name and
// call to action, the readouts as a 2x2 of square modules with their figures, and Latest's
// log rows; below, the Work board's head and the showcase panel with its two covers.
const thumbnail: StudioThumbnail = (p) => {
  const rail = mix(p.canvas, p.text, 0.05);
  const panel = p.surface;
  const bar = mix(p.surface, p.text, 0.04);
  const cover = mix(p.secondary, p.text, 0.55);
  const coverDark = shade(mix(p.text, p.secondary, 0.25), 0.25);
  // A panel: its body, its title bar ruled off, and its edge.
  const frame = (x: number, y: number, w: number, h: number, title: number) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.6} fill={panel} />
      <rect x={x} y={y} width={w} height={5.4} rx={1.6} fill={bar} />
      <Box x={x} y={y + 5.4} w={w} h={0.4} fill={p.rule} />
      <Box x={x + 2.4} y={y + 2} w={title} h={1.6} fill={p.text} rx={0.5} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1.6}
        fill="none"
        stroke={p.rule}
        strokeWidth={0.4}
      />
    </g>
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {/* The rail: the mark, then the boards' icons, ruled off from the wall. */}
      <Box x={0} y={0} w={7} h={85} fill={rail} />
      <Box x={7} y={0} w={0.4} h={85} fill={p.rule} />
      <rect
        x={1.2}
        y={1.4}
        width={4.6}
        height={4.6}
        rx={1}
        fill="none"
        stroke={p.text}
        strokeWidth={0.4}
      />
      <Box x={2.4} y={3.2} w={2.2} h={1} fill={p.text} rx={0.3} />
      {[0, 1, 2, 3, 4].map((at) => (
        <Box key={at} x={2.3} y={11 + at * 5.4} w={2.4} h={2.4} fill={p.muted} rx={0.5} />
      ))}
      {/* The status line: the name, then each reading with its lamp. */}
      <Box x={7.4} y={0} w={128.6} h={5.6} fill={bar} />
      <Box x={7.4} y={5.6} w={128.6} h={0.4} fill={p.rule} />
      <Box x={11} y={2.2} w={11} h={1.4} fill={p.text} rx={0.5} />
      {[27, 51].map((x) => (
        <g key={x}>
          <circle cx={x} cy={2.9} r={0.9} fill={p.secondary} />
          <Box x={x + 2} y={2.3} w={9} h={1.2} fill={p.muted} rx={0.5} />
          <Box x={x + 12} y={2.3} w={8} h={1.2} fill={p.strong} rx={0.5} />
        </g>
      ))}
      {/* The anchor: the name in the bar, the thesis, its lines, and the call to action. */}
      {frame(9, 8, 41, 36, 0)}
      <Headline x={11.4} y={12.4} size={4.6} fill={p.text} w={22} />
      <Box x={12} y={17.6} w={26} h={1.2} fill={p.strong} rx={0.5} />
      <Box x={12} y={21.6} w={20} h={2.2} fill={p.text} rx={0.6} />
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={12}
          y={25.6 + at * 2.4}
          w={at === 2 ? 22 : 34}
          h={1.1}
          fill={p.muted}
          rx={0.5}
        />
      ))}
      <Box x={12} y={33.6} w={35} h={0.3} fill={p.rule} />
      <rect x={12} y={37} width={10} height={4} rx={0.9} fill={p.accent} />
      <rect
        x={24}
        y={37}
        width={9}
        height={4}
        rx={0.9}
        fill="none"
        stroke={p.strong}
        strokeWidth={0.4}
      />
      {/* The readouts: four square modules, each a label over its figure. */}
      {frame(52, 8, 32, 36, 11)}
      {[0, 1].map((row) =>
        [0, 1].map((col) => {
          const x = 52 + col * 16;
          const y = 13.8 + row * 13.6;
          return (
            <g key={`${row}${col}`}>
              <Box x={x + 2} y={y + 2} w={9} h={1} fill={p.muted} rx={0.4} />
              <Box x={x + 2} y={y + 7.4} w={col === 0 ? 9.5 : 6} h={4.4} fill={p.text} rx={0.5} />
            </g>
          );
        }),
      )}
      <Box x={68} y={13.8} w={0.4} h={27.2} fill={p.rule} />
      <Box x={52} y={27.4} w={32} h={0.4} fill={p.rule} />
      <Box x={52} y={41} w={32} h={0.4} fill={p.rule} />
      {/* Latest: its dated log rows, each a date over its linked title. */}
      {frame(86, 8, 47, 36, 9)}
      {[0, 1, 2].map((at) => (
        <g key={at}>
          <Box x={88.6} y={16 + at * 7.4} w={13} h={1.3} fill={p.strong} rx={0.5} />
          <Box x={88.6} y={19 + at * 7.4} w={at === 0 ? 38 : 26} h={1.2} fill={p.text} rx={0.5} />
          <Box x={86} y={22 + at * 7.4} w={47} h={0.3} fill={p.rule} />
        </g>
      ))}
      {/* The Work board: its head, then the showcase panel and its two covers. */}
      <Box x={10} y={50} w={2.6} h={2.6} fill={p.muted} rx={0.5} />
      <Headline x={14} y={53.4} size={5} fill={p.text} w={13} />
      <Box x={30} y={51.2} w={7} h={1.3} fill={p.strong} rx={0.5} />
      <Box x={39} y={51.2} w={8} h={1.3} fill={p.strong} rx={0.5} />
      {frame(9, 57, 124, 32, 18)}
      <Box x={9} y={62.8} w={77} h={22.2} fill={cover} />
      <Box x={86.4} y={62.8} w={46.6} h={22.2} fill={coverDark} />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={30 + at * 4}
          y={65 + at * 2.4}
          width={22}
          height={18}
          rx={0.8}
          fill={mix(p.canvas, cover, 0.25 - at * 0.06)}
        />
      ))}
      {[
        [94, 67, 7],
        [104, 70, 9],
        [92, 73, 13],
        [92, 76, 26],
        [92, 79, 34],
      ].map(([x, y, w]) => (
        <Box key={`${x}${y}`} x={x!} y={y!} w={w!} h={1.8} fill={p.accent} />
      ))}
    </>
  );
};

export default thumbnail;
