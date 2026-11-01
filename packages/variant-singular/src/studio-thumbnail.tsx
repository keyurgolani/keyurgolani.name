import { Box, Headline, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// One statement to the screen: the full ground with only its two links at the head, the
// name and the one large headline low on it, the lede and the facts beneath, the pager's
// stops down the right edge, and the action band across the foot on the other ground.
const thumbnail: StudioThumbnail = (p) => {
  const bandInk = p.canvas;
  const bandInk2 = mix(p.canvas, p.text, 0.32);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <Box x={113} y={2.4} w={7.6} h={1.4} fill={p.text} rx={0.3} />
      <Box x={113} y={4.3} w={7.6} h={0.3} fill={p.text} />
      <Box x={123.6} y={2.4} w={4.8} h={1.4} fill={p.text} rx={0.3} />
      <Box x={123.6} y={4.3} w={4.8} h={0.3} fill={p.text} />
      <Box x={131.6} y={28.8} w={1} h={2.4} fill={p.accent} rx={0.5} />
      {[0, 1, 2, 3, 4].map((at) => (
        <circle
          key={at}
          cx={132.1}
          cy={34.2 + at * 4.2}
          r={0.5}
          fill="none"
          stroke={p.strong}
          strokeWidth={0.3}
        />
      ))}
      <Box x={131.4} y={54.8} w={1.4} h={0.3} fill={p.text} />
      <Box x={7.6} y={40} w={15} h={1.8} fill={p.text} rx={0.3} />
      <Headline x={7.2} y={52.4} size={13} fill={p.text} w={80} />
      {[46, 42, 40].map((w, at) => (
        <Box key={at} x={7.6} y={56.6 + at * 2.8} w={w} h={1.5} fill={p.text} rx={0.3} />
      ))}
      <Box x={89.4} y={56.2} w={37} h={1.3} fill={p.text} rx={0.3} />
      <Box x={89.4} y={59.2} w={23} h={1.3} fill={p.text} rx={0.3} />
      <Box x={89.4} y={63.2} w={24} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={89.4} y={66.1} w={15.6} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={89.4} y={70} w={22} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={0} y={77.9} w={136} h={7.1} fill={p.text} />
      <Box x={7.6} y={80.8} w={6.4} h={1.2} fill={bandInk2} rx={0.3} />
      <Box x={28} y={80.6} w={14} h={1.7} fill={bandInk} rx={0.3} />
      <Box x={28} y={82.7} w={14} h={0.3} fill={bandInk2} />
      <Box x={115.4} y={80.8} w={8.2} h={1.3} fill={bandInk2} rx={0.3} />
      <path
        d="M127 80.2v3M125.8 82l1.2 1.3l1.2-1.3"
        fill="none"
        stroke={bandInk}
        strokeWidth={0.35}
      />
    </>
  );
};

export default thumbnail;
