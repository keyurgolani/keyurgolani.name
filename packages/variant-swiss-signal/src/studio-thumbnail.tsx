import { Box, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The poster that works as an index: the twelve columns faint behind it, the masthead on its
// heavy rule, the thesis flush left in two uppercase lines with the one signal block where its
// aside stands, the lede on the left and the numbered, ruled index of selected work on the
// right, then the figures band on its heavy rule. Square corners, and the canvas left open.
const thumbnail: StudioThumbnail = (p) => {
  const column = mix(p.canvas, p.rule, 0.55);
  const plate = mix(p.secondary, p.text, 0.5);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {Array.from({ length: 11 }, (_, at) => (
        <Box key={at} x={5 + (at + 1) * 10.5} y={8} w={0.3} h={77} fill={column} />
      ))}
      <Box x={5} y={3.2} w={14} h={1.6} fill={p.text} />
      <Box x={47} y={3.4} w={22} h={1.2} fill={p.muted} />
      <Box x={124} y={3.2} w={7} h={1.6} fill={p.strong} />
      <Box x={0} y={7} w={136} h={0.9} fill={p.text} />
      {/* The thesis in uppercase: square blocks at the cap height, never a rounded bar. */}
      <Box x={5} y={11.6} w={74} h={8.6} fill={p.text} />
      <Box x={5} y={23.4} w={44} h={8.6} fill={p.text} />
      <Box x={51.5} y={28.2} w={24} h={3.8} fill={p.accent} />
      <Box x={5} y={36} w={126} h={0.4} fill={p.strong} />
      {[40.5, 43.3, 46.1].map((y, at) => (
        <Box key={y} x={5} y={y} w={at === 2 ? 24 : 36} h={1.3} fill={p.strong} />
      ))}
      <Box x={5} y={50.5} w={30} h={1} fill={p.muted} />
      <Box x={5} y={55.5} w={13} h={1.6} fill={p.text} />
      <Box x={5} y={57.6} w={13} h={0.5} fill={p.text} />
      <Box x={22} y={55.7} w={8} h={1.2} fill={p.strong} />
      <Box x={68} y={40} w={14} h={1} fill={p.strong} />
      {[0, 1, 2].map((at) => {
        const y = 43 + at * 7.2;
        return (
          <g key={at}>
            <Box x={68} y={y} w={63} h={0.3} fill={p.rule} />
            <Box x={68} y={y + 1.6} w={1.2} h={1.6} fill={p.muted} />
            {at < 2 ? <Box x={73} y={y + 1.4} w={8} h={4.6} fill={plate} /> : null}
            <Box x={at < 2 ? 84 : 73} y={y + 1.8} w={18} h={1.5} fill={p.text} />
            <Box x={at < 2 ? 84 : 73} y={y + 4.2} w={11} h={1} fill={p.muted} />
            <Box x={117} y={y + 2.6} w={14} h={1} fill={p.muted} />
          </g>
        );
      })}
      <Box x={68} y={64.6} w={63} h={0.3} fill={p.rule} />
      <Box x={5} y={68} w={126} h={0.9} fill={p.text} />
      {[0, 1, 2, 3].map((at) => (
        <g key={at}>
          {at > 0 ? <Box x={5 + at * 31.5 - 2} y={72} w={0.3} h={10} fill={p.rule} /> : null}
          <Box x={5 + at * 31.5} y={72} w={at === 2 ? 9 : 7} h={4.4} fill={p.text} />
          <Box x={5 + at * 31.5} y={78.4} w={18} h={1} fill={p.muted} />
        </g>
      ))}
    </>
  );
};

export default thumbnail;
