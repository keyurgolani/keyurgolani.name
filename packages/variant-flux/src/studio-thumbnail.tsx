import { Box, Headline, mix, tint, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The field as its first view stands: the dock of pill tabs across the top, the drop pouring
// in from the top right, the greeting over the thesis set large in the scheme's two colours,
// the lede and its call, and the signature work's plate on its blob; then the sheets rising
// from the field, each a surface whose tab melts out of its top edge with the lip's drip on
// its shoulder, the tabs stepping across in reading order.
const thumbnail: StudioThumbnail = (p) => {
  const plate = mix(p.secondary, p.text, 0.55);
  // The sheets stand off the field a step further than a surface does, so their edges read.
  const leaf = mix(p.canvas, p.text, 0.11);
  // A sheet: its surface from `y` down past the frame, its tab standing on its top edge at
  // `x` with the word in it, and the drip on the tab's end shoulder.
  const sheet = (x: number, y: number, word: number) => (
    <g>
      <rect x={0} y={y} width={136} height={40} rx={4} fill={leaf} />
      <rect x={x} y={y - 6.4} width={word + 7} height={9} rx={2.6} fill={leaf} />
      <Headline x={x + 3} y={y - 0.8} size={6.6} fill={p.text} w={word} />
      <ellipse cx={x + word + 5.4} cy={y - 6.2} rx={1.1} ry={1.6} fill={p.accent} />
    </g>
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {/* The drop, pouring in from the frame's top right. */}
      <path
        d="M101 0 C99 7 104 12 103 18 C102 25 109 30 116 32 C122 34 125 40 131 39 C135 38 136 34 136 30 L136 0 Z"
        fill={p.accent}
      />
      {/* The dock: the name's pill lit, the destinations, the Index and Pause. */}
      <rect x={4} y={3} width={16} height={4.4} rx={2.2} fill={p.text} />
      <Box x={7} y={4.6} w={10} h={1.2} fill={p.canvas} rx={0.6} />
      {[24, 32, 40, 48, 56].map((x) => (
        <Box key={x} x={x} y={4.6} w={5.5} h={1.2} fill={p.strong} rx={0.6} />
      ))}
      {[0, 1].map((row) =>
        [0, 1].map((col) => (
          <circle
            key={`${row}${col}`}
            cx={68 + col * 1.6}
            cy={4.4 + row * 1.6}
            r={0.45}
            fill={p.text}
          />
        )),
      )}
      <Box x={71.5} y={4.6} w={5} h={1.2} fill={p.text} rx={0.6} />
      <rect
        x={80}
        y={3}
        width={9}
        height={4.4}
        rx={1.4}
        fill="none"
        stroke={p.strong}
        strokeWidth={0.4}
      />
      {/* The greeting, then the thesis large, its words running from one colour to the other. */}
      <Headline x={6} y={18} size={7} fill={p.text} w={48} />
      {[
        [6, 4],
        [11.6, 15],
        [28.2, 18],
        [47.8, 21],
      ].map(([x, w], at) => (
        <Headline
          key={at}
          x={x!}
          y={29.5}
          size={10}
          fill={mix(p.accent, p.secondary, at / 3)}
          w={w!}
        />
      ))}
      {/* The lede and its call. */}
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={6}
          y={35 + at * 2.6}
          w={at === 2 ? 22 : 31}
          h={1.2}
          fill={p.muted}
          rx={0.6}
        />
      ))}
      <rect x={6} y={44} width={13} height={3.6} rx={1.8} fill={p.text} />
      {/* The signature work: its line and title, then its plate held in a blob, a second blob beside. */}
      <Box x={74} y={34.5} w={18} h={1} fill={p.muted} rx={0.5} />
      <Box x={74} y={37.4} w={22} h={1.8} fill={p.text} rx={0.6} />
      <path
        d="M66 50 C64 46 68 44 70 46 C72 48 70 51 72 53 C74 56 72 60 68 59 C64 58 63 54 66 50 Z"
        fill={p.secondary}
      />
      <path
        d="M73 44 C80 41 96 42 103 44 C108 46 108 54 104 57 C98 60 82 60 76 58 C71 56 71 47 73 44 Z"
        fill={plate}
      />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={81 + at * 2.4}
          y={45.5 + at * 1.6}
          width={13}
          height={9}
          rx={0.6}
          fill={tint(p.canvas, 0.55 + at * 0.12)}
        />
      ))}
      {/* The sheets: Work's, its tab at the start, and the next one's below, a step across. */}
      {sheet(8, 62, 19)}
      <circle cx={18} cy={71} r={5.4} fill={plate} />
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={28}
          y={67.6 + at * 2.6}
          w={at === 0 ? 16 : 26}
          h={at === 0 ? 1.8 : 1.1}
          fill={at === 0 ? p.text : p.muted}
          rx={0.6}
        />
      ))}
      <Box x={0} y={77.2} w={136} h={7.8} fill={p.canvas} />
      {sheet(54, 84.6, 22)}
    </>
  );
};

export default thumbnail;
