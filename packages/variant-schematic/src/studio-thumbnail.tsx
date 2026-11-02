import { Box, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The cover sheet of the drawing set: the double drawing frame with its column ticks along the
// top and bottom and its row ticks down the sides, the drafting grid faint on the paper, the
// name boxed twice under its dimension line, the lede and the numbered notes on their leader,
// Fig. 1's ruled box with the interface and its dimension arrow, and the title block of cells
// at the bottom right. Ink lines on paper, in the palette's own ink.
const thumbnail: StudioThumbnail = (p) => {
  const grid = mix(p.canvas, p.text, 0.07);
  const sheet = mix(p.canvas, p.text, 0.035);
  const line = (x: number, y: number, w: number, h: number, fill = p.text) => (
    <Box x={x} y={y} w={w} h={h} fill={fill} />
  );
  const frame = (x: number, y: number, w: number, h: number, width: number, stroke = p.text) => (
    <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={width} />
  );
  /** A dimension: a line between two arrowheads, its figure a bar in its middle. */
  const dimension = (x: number, y: number, w: number) => (
    <g>
      <path d={`M${x} ${y}l2 -0.9v1.8z`} fill={p.accent} />
      <path d={`M${x + w} ${y}l-2 -0.9v1.8z`} fill={p.accent} />
      {line(x + 1.5, y - 0.15, w / 2 - 7, 0.3, p.accent)}
      {line(x + w / 2 + 5.5, y - 0.15, w / 2 - 7, 0.3, p.accent)}
      <Box x={x + w / 2 - 4.5} y={y - 0.8} w={9} h={1.6} fill={p.accent} />
    </g>
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {Array.from({ length: 21 }, (_, at) => (
        <Box key={`v${at}`} x={8 + at * 6} y={5} w={0.25} h={75} fill={grid} />
      ))}
      {Array.from({ length: 12 }, (_, at) => (
        <Box key={`h${at}`} x={5} y={9 + at * 6} w={126} h={0.25} fill={grid} />
      ))}
      {frame(1.5, 1.5, 133, 82, 0.6)}
      {frame(5, 5, 126, 75, 0.4)}
      {Array.from({ length: 8 }, (_, at) => (
        <g key={at}>
          {at > 0 ? line(5 + at * 15.75, 1.5, 0.3, 3.5, p.strong) : null}
          {at > 0 ? line(5 + at * 15.75, 80, 0.3, 3.5, p.strong) : null}
          {line(12.4 + at * 15.75, 2.6, 0.9, 1.4, p.strong)}
          {line(12.4 + at * 15.75, 81, 0.9, 1.4, p.strong)}
        </g>
      ))}
      {[0, 1, 2, 3].map((at) => (
        <g key={at}>
          {line(2.6, 13 + at * 18.75, 1.4, 1.2, p.strong)}
          {line(132, 13 + at * 18.75, 1.4, 1.2, p.strong)}
        </g>
      ))}
      {dimension(9, 9.5, 54)}
      {frame(9, 13, 54, 14, 0.6)}
      {frame(10.4, 14.4, 51.2, 11.2, 0.35)}
      <Box x={13} y={16.6} w={44} h={6.6} fill={p.text} />
      {line(66, 13, 0.3, 14, p.accent)}
      {line(64.8, 13, 2.4, 0.3, p.accent)}
      {line(64.8, 26.7, 2.4, 0.3, p.accent)}
      {[31, 34, 37].map((y, at) => (
        <Box key={y} x={13} y={y} w={at === 2 ? 26 : 40} h={1.2} fill={p.strong} />
      ))}
      {line(13, 40.4, 30, 0.9, p.muted)}
      {frame(13, 44, 14, 4.4, 0.4, p.accent)}
      <Box x={16} y={45.6} w={8} h={1.2} fill={p.accent} />
      {line(30, 45.6, 8, 1.2, p.text)}
      {line(10.6, 52, 0.3, 24, p.accent)}
      {[54, 61.5, 69].map((y) => (
        <g key={y}>
          <circle cx={10.75} cy={y} r={1.5} fill={p.canvas} stroke={p.accent} strokeWidth={0.35} />
          <Box x={15} y={y - 1.6} w={10} h={2.6} fill={p.secondary} />
          {line(15, y + 2, 34, 0.9, p.muted)}
        </g>
      ))}
      <Box x={70} y={9} w={58} h={41} fill={sheet} />
      {frame(70, 9, 58, 41, 0.5)}
      {line(72, 11.4, 5, 1.2, p.accent)}
      {line(80, 11.2, 22, 1.6, p.text)}
      {line(80, 14, 34, 0.9, p.muted)}
      {line(70, 17, 58, 0.35, p.text)}
      {dimension(104, 20, 22)}
      {frame(104, 23, 22, 13, 0.45)}
      {[26.5, 30, 33.5].map((y) => (
        <g key={y}>
          {frame(104.8, y - 0.8, 1.6, 1.6, 0.3)}
          {line(108, y - 0.5, 10, 1, p.text)}
        </g>
      ))}
      {[21, 29].map((y) => (
        <g key={y}>
          {line(73, y, 4, 1, p.text)}
          {line(73, y + 2.4, 24, 0.9, p.strong)}
          {line(73, y + 4.4, 20, 0.9, p.strong)}
        </g>
      ))}
      <path d="M100 26.9l-2 -0.9v1.8z" fill={p.accent} />
      {line(88, 26.75, 11, 0.3, p.accent)}
      {dimension(73, 39.5, 52)}
      {frame(73, 42, 52, 6, 0.3, p.strong)}
      <Box x={70} y={55} w={58} h={23} fill={sheet} />
      {frame(70, 55, 58, 23, 0.6)}
      {line(70, 61, 58, 0.35, p.text)}
      {line(70, 71.5, 58, 0.35, p.text)}
      {line(88, 61, 0.35, 10.5, p.text)}
      {line(112, 55, 0.35, 23, p.text)}
      {line(72, 57.4, 6, 1, p.strong)}
      {[80, 90, 100].map((x) => (
        <Box key={x} x={x} y={57.4} w={8} h={1} fill={p.accent} />
      ))}
      {frame(115, 57, 8, 3.4, 0.35)}
      {line(72, 63.2, 7, 0.9, p.strong)}
      {line(72, 66.4, 12, 1, p.text)}
      {line(91, 63.2, 6, 0.9, p.strong)}
      {line(91, 66.4, 16, 1, p.text)}
      {line(114, 63.2, 9, 0.9, p.strong)}
      {line(114, 66.4, 10, 1.2, p.text)}
      {line(72, 74, 30, 1, p.text)}
      {line(114, 73.4, 7, 0.9, p.strong)}
      {line(114, 75.6, 11, 1, p.text)}
    </>
  );
};

export default thumbnail;
