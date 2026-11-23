import { Box, Headline, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of Pull Request (`./studio-thumbnail`), which its picker and Compare's grid
// draw before a live frame: pure, the palette in and the SVG out, 136 by 85 (16:10). A starter
// from the scaffold: redraw it as the home page's structure at 1440 by 900, in Box and
// Headline, palette only, with no text.
const thumbnail: StudioThumbnail = (p) => (
  <>
    <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
    <Box x={8} y={6} w={24} h={2} fill={p.text} rx={1} />
    <Box x={0} y={12} w={136} h={0.6} fill={p.rule} />
    <Headline x={8} y={32} size={14} fill={p.text} />
    <Box x={8} y={40} w={60} h={2} fill={p.strong} rx={1} />
    <Box x={8} y={52} w={120} h={26} fill={p.surface} rx={2} />
    <Box x={14} y={60} w={30} h={2} fill={p.accent} rx={1} />
  </>
);

export default thumbnail;
