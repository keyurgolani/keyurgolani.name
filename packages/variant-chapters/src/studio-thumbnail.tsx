import { Box, Headline, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// The open book: a spread on its gutter rule under the two running heads, the title page on
// the verso and the contents on the recto, each chapter's numeral, title and folio; the
// fore-edge down the outer edge, the book in tabs sized by their pages with your place
// marked; and a folio at each page's foot.
const thumbnail: StudioThumbnail = (p) => {
  const edge = mix(p.canvas, p.text, 0.05);
  const tab = mix(p.canvas, p.text, 0.26);
  const numerals = [
    mix(p.accent, p.canvas, 0.4),
    mix(p.secondary, p.canvas, 0.3),
    mix(p.accent, p.text, 0.35),
  ];
  // The fore-edge's tabs, top to bottom: front matter (your place), the three chapters, and
  // the back matter, each as long as its pages.
  const tabs = [
    [10, 5],
    [17.2, 6],
    [25.6, 6],
    [34, 33],
    [69.4, 11],
  ];
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <Box x={0} y={0} w={1.5} h={85} fill={edge} />
      <Box x={134.5} y={0} w={1.5} h={85} fill={edge} />
      <Box x={8} y={2.6} w={12} h={1.2} fill={p.text} rx={0.3} />
      <Box x={53} y={2.6} w={11} h={1.1} fill={p.muted} rx={0.3} />
      <Box x={72} y={2.6} w={7} h={1.2} fill={p.text} rx={0.3} />
      <Box x={109.4} y={2.6} w={4} h={1.2} fill={p.text} rx={0.3} />
      <Box x={115.2} y={2.6} w={12.8} h={1.2} fill={p.text} rx={0.3} />
      <Box x={1.5} y={5.8} w={133} h={0.3} fill={p.rule} />
      <Box x={67.8} y={0} w={0.4} h={85} fill={p.rule} />
      {tabs.map(([y, h], at) => (
        <g key={y}>
          <Box x={2.9} y={y! - 2.3} w={1.2} h={1.3} fill={at === 0 ? p.text : p.strong} />
          <Box x={2.7} y={y!} w={1.6} h={h!} fill={at === 0 ? p.accent : tab} rx={0.3} />
        </g>
      ))}
      <Box x={2.1} y={14.6} w={2.8} h={0.5} fill={p.text} />
      <Box x={11.6} y={9.6} w={13} h={1.6} fill={p.strong} rx={0.3} />
      <Headline x={11.6} y={22.4} size={9.4} fill={p.text} w={28} />
      <Headline x={11.6} y={31.2} size={9.4} fill={p.text} w={27} />
      <Headline x={11.6} y={40} size={9.4} fill={p.text} w={29.6} />
      {[51, 50, 34].map((w, at) => (
        <Box key={at} x={11.6} y={44.4 + at * 3.2} w={w} h={1.4} fill={p.strong} rx={0.3} />
      ))}
      <Box x={11.6} y={57.8} w={13.6} h={1.7} fill={p.text} rx={0.3} />
      <Box x={11.6} y={60.1} w={13.6} h={0.35} fill={p.accent} />
      {[0, 1, 2].map((at) => (
        <Box key={at} x={11.6 + at * 7} y={62.2} w={5.4} h={1} fill={p.muted} rx={0.3} />
      ))}
      <Box x={11.6} y={65} w={52.4} h={0.3} fill={p.rule} />
      <Box x={11.6} y={67.4} w={47} h={1.3} fill={p.text} rx={0.3} />
      <Box x={11.6} y={70.2} w={34} h={1.1} fill={p.muted} rx={0.3} />
      <Box x={11.6} y={81.6} w={0.6} h={1.1} fill={p.strong} />
      <Box x={72} y={9.4} w={26} h={1.2} fill={p.strong} rx={0.3} />
      <Box x={80} y={14.4} w={9} h={1.8} fill={p.strong} rx={0.3} />
      <Box x={126.2} y={14.8} w={1.8} h={1.1} fill={p.muted} />
      {[
        [20, 2, 24],
        [37, 1, 20],
        [52, 3, 26],
      ].map(([y, lines, w], at) => (
        <g key={y}>
          <Headline x={72.6} y={y! + 5.6} size={8} fill={numerals[at]!} w={3} />
          <Box x={80} y={y! + 0.6} w={w!} h={2.2} fill={p.text} rx={0.3} />
          {at === 0 ? <Box x={80} y={y! + 3.6} w={14} h={2.2} fill={p.text} rx={0.3} /> : null}
          {[0, 1, 2].slice(0, lines).map((line) => (
            <Box
              key={line}
              x={80}
              y={y! + (at === 0 ? 7.2 : 3.8) + line * 1.9}
              w={line === 0 ? 30 : 38 - line * 8}
              h={0.9}
              fill={p.muted}
              rx={0.3}
            />
          ))}
          {Array.from({ length: at === 2 ? 12 : 4 }, (_, tick) => (
            <Box
              key={tick}
              x={80 + tick * 0.9}
              y={y! + (at === 0 ? 11.6 : at === 1 ? 6.8 : 10.8)}
              w={0.35}
              h={1.4}
              fill={at === 2 ? p.strong : p.rule}
            />
          ))}
          <Box x={126.6} y={y! + 0.9} w={1.4} h={1.1} fill={p.muted} />
        </g>
      ))}
      <Box x={72} y={71.4} w={56} h={0.3} fill={p.rule} />
      <Box x={80} y={74.4} w={16} h={1.8} fill={p.strong} rx={0.3} />
      <Box x={126.2} y={74.8} w={1.8} h={1.1} fill={p.muted} />
      <Box x={126.8} y={81.6} w={1.2} h={1.1} fill={p.strong} />
    </>
  );
};

export default thumbnail;
