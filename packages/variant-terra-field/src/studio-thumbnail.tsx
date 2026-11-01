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
// The opening at 16:10, as the page lays it out: the field in the accent, the axial
// masthead on it, the hero's one centred column (kicker, display line, lede, the action,
// the subtagline), the field's lower edge the wide arc, and the seal on the arc's lowest
// point. Below it on paper, the anchor band's 2fr 1fr 1fr: the plate, then two columns
// under their rules.

const HEX = /^#[0-9a-f]{6}$/i;

/** The relative luminance of a #rrggbb colour (WCAG 2.x). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/**
 * Whether black reads more strongly than white on a ground of luminance `l`, as the scheme
 * derives on-accent: (l + 0.05) / 0.05 against 1.05 / (l + 0.05), which is black's from
 * (l + 0.05)² = 0.0525 up.
 */
const blackOn = (l: number) => (l + 0.05) ** 2 >= 0.0525;

/**
 * The field's ink, as the scheme derives on-accent: black or white, whichever reads more
 * strongly on the accent. Drawn from the palette: the darker of its text and canvas in
 * shadow, or the lighter in light. The text, for anything but #rrggbb.
 */
const inkOn = (ground: string, text: string, canvas: string) => {
  if (!HEX.test(ground) || !HEX.test(text) || !HEX.test(canvas)) return text;
  const [darker, lighter] = luminance(text) < luminance(canvas) ? [text, canvas] : [canvas, text];
  return blackOn(luminance(ground)) ? shade(darker, 0.5) : tint(lighter, 0.5);
};

const thumbnail: StudioThumbnail = (p) => {
  const field = p.accent;
  const ink = inkOn(field, p.text, p.canvas);
  const plate = mix(p.secondary, p.text, 0.55);
  const dusk = mix(plate, p.accent, 0.4);
  const label = mix(p.accent, p.text, 0.3);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {/* The field, its lower edge the arc: level at the window's edges, lowest at its middle. */}
      <path d="M0 0H136V51A68 13 0 0 1 0 51Z" fill={field} />
      {[
        [7.6, 3.4],
        [13.7, 4.9],
        [21.4, 4.6],
        [103, 4],
        [109.8, 5.2],
      ].map(([x, w]) => (
        <Box key={x} x={x!} y={3.7} w={w!} h={1.2} fill={ink} rx={0.6} />
      ))}
      <Box x={60.7} y={3.2} w={14.6} h={2} fill={ink} rx={1} />
      <path d="M117.6 4.8Q118.8 3.8 120 4.8" fill="none" stroke={ink} strokeWidth={0.3} />
      <Box x={121} y={3.7} w={7.4} h={1.2} fill={ink} rx={0.6} />
      <Box x={121} y={5.4} w={7.4} h={0.25} fill={ink} />
      <Box x={42.8} y={11.4} w={50.4} h={1.2} fill={ink} rx={0.6} />
      <Headline x={25.5} y={23.6} size={12} fill={ink} w={85} />
      {[
        [42.25, 28.6, 51.5],
        [42.5, 32.1, 51],
        [57, 35.6, 22],
      ].map(([x, y, w]) => (
        <Box key={y} x={x!} y={y!} w={w!} h={1.5} fill={ink} rx={0.75} />
      ))}
      <Box x={62.2} y={41.1} w={11.6} h={4.6} fill={p.canvas} rx={2.3} />
      <Box x={64.6} y={42.8} w={6.8} h={1.2} fill={p.text} rx={0.6} />
      <Box x={56.75} y={48.9} w={22.5} h={1.1} fill={ink} rx={0.55} />
      <Box x={53.9} y={51.2} w={28.2} h={1.1} fill={ink} rx={0.55} />
      {/* The anchor band: the plate, a dusk with its sun, under the seal's edge. */}
      <Box x={7.6} y={64.1} w={59} h={21} fill={plate} rx={1.5} />
      {[0, 1, 2].map((at) => (
        <Box
          key={at}
          x={7.6}
          y={70 + at * 5}
          w={59}
          h={15 - at * 5}
          fill={mix(plate, dusk, (at + 1) / 3)}
        />
      ))}
      <circle cx={44.4} cy={81.2} r={3.7} fill={p.accent} />
      {[69.4, 100.4].map((x, at) => (
        <g key={x}>
          <Box x={x} y={73.3} w={28.2} h={0.3} fill={p.rule} />
          <Box x={x} y={75.6} w={at === 0 ? 11.4 : 8.4} h={1.2} fill={label} rx={0.6} />
          <Box x={x} y={78.6} w={at === 0 ? 27 : 16.7} h={2.2} fill={p.text} rx={1.1} />
          <Box x={x} y={82.6} w={at === 0 ? 25 : 19.3} h={1.2} fill={p.muted} rx={0.6} />
        </g>
      ))}
      {/* The seal on the arc's lowest point, on paper, its ring inset. */}
      <circle cx={68} cy={63.6} r={7.4} fill={p.canvas} />
      <circle cx={68} cy={63.6} r={6.5} fill="none" stroke={p.rule} strokeWidth={0.3} />
      <Box x={65.2} y={59.3} w={5.6} h={3.4} fill={p.text} rx={0.5} />
      <Box x={65.3} y={64.5} w={5.4} h={1} fill={p.strong} rx={0.5} />
      <Box x={64} y={66.8} w={8} h={1} fill={p.strong} rx={0.5} />
    </>
  );
};

export default thumbnail;
