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
// The entrance as it stands at 1440 by 900, scaled down: the wall in its light, the chrome
// with the three rooms on its axis, the signature work on its canvas mat at the wall's
// centre, the hairline wall label in the lower-left corner, then the floor band carrying
// the thesis, where the owner is, and the way on.
const thumbnail: StudioThumbnail = (p) => {
  const wall = mix(p.canvas, p.text, 0.09);
  const floor = mix(wall, p.text, 0.22);
  const plate = mix(p.secondary, p.text, 0.6);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={wall} />
      {/* The pool of light over the work, soft at its edge: no gradient, so no id to collide. */}
      {[1, 0.72, 0.44].map((at) => (
        <ellipse
          key={at}
          cx={68}
          cy={12}
          rx={50 * at}
          ry={24 * at}
          fill={tint(wall, 0.4)}
          opacity={0.22}
        />
      ))}
      {/* The chrome: the name and role, the rooms on the axis, the entrance and Index. */}
      <Box x={7.5} y={2.8} w={8.4} h={1.2} fill={p.text} rx={0.6} />
      <Box x={7.5} y={5.8} w={14.8} h={1} fill={p.strong} rx={0.5} />
      {[
        [58.6, 8.7],
        [69.2, 9.2],
        [80.2, 11.4],
      ].map(([x, w]) => (
        <Box key={x} x={x!} y={2.9} w={w!} h={1.1} fill={p.strong} rx={0.55} />
      ))}
      <circle cx={109.6} cy={3.45} r={0.55} fill={p.accent} />
      <Box x={111} y={2.9} w={5.5} h={1.1} fill={p.strong} rx={0.55} />
      <rect
        x={119.4}
        y={1.5}
        width={9}
        height={4}
        rx={0.8}
        fill="none"
        stroke={p.strong}
        strokeWidth={0.25}
      />
      <Box x={121.4} y={3} w={5} h={1} fill={p.text} rx={0.5} />
      {/* The signature work on its mat, raised off the wall. */}
      <Box x={31.2} y={11} w={74.8} h={50.2} fill={shade(wall, 0.12)} />
      <Box x={30.6} y={10.1} w={74.8} h={50.2} fill={p.canvas} />
      <Box x={35.3} y={14.8} w={65.3} h={40.8} fill={plate} />
      {[0, 1, 2, 3, 4].map((at) => (
        <rect
          key={at}
          x={48.3 + at * 4}
          y={22.2 + at * 2}
          width={27.4}
          height={22.8}
          rx={0.9}
          fill={tint(plate, 0.72 + at * 0.06)}
        />
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((at) => (
        <Box key={at} x={66.2} y={32.9 + at * 1.9} w={23.2} h={0.3} fill={p.muted} />
      ))}
      {/* The wall label: a hairline, then the number and title, then three lines in the secondary ink. */}
      <Box x={7.6} y={50.8} w={17} h={0.2} fill={p.strong} />
      <Box x={7.6} y={52.6} w={6.9} h={1} fill={p.text} rx={0.5} />
      <Box x={7.6} y={54.2} w={15.7} h={1} fill={p.text} rx={0.5} />
      {[13.1, 14, 17].map((w, at) => (
        <Box key={w} x={7.6} y={55.8 + at * 1.6} w={w} h={1} fill={p.strong} rx={0.5} />
      ))}
      {/* The floor: its line, the thesis centred on it, and its front edge. */}
      <Box x={0} y={64.1} w={136} h={20.9} fill={floor} />
      <Box x={0} y={64.1} w={136} h={0.3} fill={mix(floor, p.text, 0.3)} />
      <Headline x={41.8} y={75.4} size={6} fill={p.text} w={52.2} />
      <Box x={7.5} y={80.6} w={15.8} h={1.1} fill={p.text} rx={0.55} />
      <Box x={116.5} y={80.6} w={11.9} h={1.1} fill={p.text} rx={0.55} />
      <Box x={116.5} y={82.2} w={11.9} h={0.25} fill={p.text} />
    </>
  );
};

export default thumbnail;
