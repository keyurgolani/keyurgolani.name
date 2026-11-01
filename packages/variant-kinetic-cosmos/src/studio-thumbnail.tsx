import { Box, Headline, mix, shade, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of this composition (`./studio-thumbnail`), which its picker and
// Compare's grid draw before a live frame: pure, the palette in and the SVG out, 136 by 85.
// An ink inset stage: a legend of four leader lines on the left, running to nodes on a
// tilted orrery round a core, the headline set low on the left.
const thumbnail: StudioThumbnail = (p) => {
  const ink = shade(p.text, 0.15);
  const light = mix(p.canvas, ink, 0.12);
  const faint = mix(p.canvas, ink, 0.55);
  const cx = 97;
  const cy = 30;
  const node = (rx: number, ry: number, angle: number) => {
    const a = (angle * Math.PI) / 180;
    const tilt = (-14 * Math.PI) / 180;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return [
      cx + x * Math.cos(tilt) - y * Math.sin(tilt),
      cy + x * Math.sin(tilt) + y * Math.cos(tilt),
    ] as const;
  };
  const legend = [
    [18, node(40, 14, 200)],
    [24, node(30, 10, 160)],
    [30, node(22, 7, 140)],
    [36, node(40, 14, 130)],
  ] as const;
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <rect x={2} y={2} width={132} height={81} rx={5} fill={ink} />
      <circle cx={10} cy={9} r={2.6} fill="none" stroke={light} strokeWidth={0.6} />
      <circle cx={10} cy={9} r={1} fill={light} />
      <Box x={15} y={7.6} w={16} h={1.4} fill={light} rx={0.7} />
      <Box x={15} y={10.4} w={12} h={1} fill={faint} rx={0.5} />
      <Box x={52} y={7.6} w={34} h={1.1} fill={faint} rx={0.5} />
      <Box x={52} y={10.2} w={28} h={1.1} fill={faint} rx={0.5} />
      <rect
        x={116}
        y={6}
        width={14}
        height={6}
        rx={1.5}
        fill="none"
        stroke={faint}
        strokeWidth={0.6}
      />
      {[0.6, 1, 1.35].map((scale, at) => (
        <ellipse
          key={at}
          cx={cx}
          cy={cy}
          rx={22 * scale + 6}
          ry={(22 * scale + 6) * 0.34}
          transform={`rotate(-14 ${cx} ${cy})`}
          fill="none"
          stroke={faint}
          strokeWidth={0.5}
          strokeDasharray={at === 2 ? '1 1.4' : undefined}
        />
      ))}
      <circle cx={cx + 3} cy={cy - 1} r={5} fill={p.accent} />
      <circle cx={cx - 8} cy={cy + 1} r={2.4} fill={light} />
      {legend.map(([y, [x, ny]], at) => (
        <g key={at}>
          <circle cx={9} cy={y} r={1.6} fill="none" stroke={light} strokeWidth={0.5} />
          <Box x={13} y={y - 1.4} w={10} h={1.3} fill={light} rx={0.6} />
          <Box x={13} y={y + 0.6} w={14} h={0.9} fill={faint} rx={0.45} />
          <path
            d={`M30 ${y} H${(x - 12).toFixed(1)} L${x.toFixed(1)} ${ny.toFixed(1)}`}
            fill="none"
            stroke={faint}
            strokeWidth={0.45}
          />
          <circle cx={x.toFixed(1)} cy={ny.toFixed(1)} r={1.5} fill={light} />
        </g>
      ))}
      <Headline x={7} y={66} size={15} fill={light} />
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={88}
          y={50 + at * 3.2}
          w={at === 2 ? 26 : 38}
          h={1.4}
          fill={light}
          rx={0.7}
        />
      ))}
      <rect x={88} y={61} width={16} height={5} rx={1.2} fill={light} />
      <Box x={7} y={73} w={122} h={0.4} fill={faint} />
      {[7, 37, 67, 97, 127].map((x) => (
        <path key={x} d={`M${x} 71.8v2.4M${x - 1.2} 73h2.4`} stroke={faint} strokeWidth={0.4} />
      ))}
      <Box x={7} y={77} w={42} h={1.3} fill={light} rx={0.6} />
      <rect
        x={112}
        y={75.5}
        width={18}
        height={4.5}
        rx={1}
        fill="none"
        stroke={faint}
        strokeWidth={0.5}
      />
    </>
  );
};

export default thumbnail;
