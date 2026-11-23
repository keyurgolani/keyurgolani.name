import { Box, Headline, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';

// Studio's thumbnail of Pull Request (`./studio-thumbnail`): the review page at 1440 by 900,
// in Box and Headline, palette only, with no text. The header band in the accent across the
// top with the title's bar; the tabs down the start, the first one selected; a file's diff in
// the middle, its removed lines tinted toward the secondary and its added toward the accent,
// a note pinned under them; and the merge box at the end, dark, its button in the accent.
const thumbnail: StudioThumbnail = (p) => {
  const added = mix(p.canvas, p.accent, 0.22);
  const removed = mix(p.canvas, p.secondary, 0.22);
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      <Box x={0} y={0} w={136} h={22} fill={p.accent} />
      <Box x={8} y={4} w={18} h={2} fill={p.canvas} rx={1} />
      <Headline x={8} y={14} size={8} fill={p.canvas} />
      <Box x={8} y={17} w={40} h={1.5} fill={p.canvas} rx={0.75} />
      {/* The tabs, the first selected, then the file tree's rule. */}
      <Box x={8} y={27} w={20} h={6} fill={p.accent} rx={1} />
      {[36, 43, 50].map((y) => (
        <Box key={y} x={8} y={y} w={20} h={4} fill={p.surface} rx={1} />
      ))}
      <Box x={8} y={58} w={20} h={0.6} fill={p.rule} />
      {[61, 64, 67].map((y) => (
        <Box key={y} x={10} y={y} w={16} h={1.2} fill={p.muted} rx={0.6} />
      ))}
      {/* A file: its header, two removed lines, three added, and a note. */}
      <Box x={33} y={27} w={66} h={52} fill={p.rule} rx={1.5} />
      <Box x={33.5} y={27.5} w={65} h={51} fill={p.canvas} rx={1.2} />
      <Box x={33.5} y={27.5} w={65} h={5} fill={p.surface} />
      <Box x={36} y={29.3} w={28} h={1.4} fill={p.strong} rx={0.7} />
      {[35, 39].map((y) => (
        <Box key={y} x={33.5} y={y} w={65} h={3.4} fill={removed} />
      ))}
      {[43, 47, 51].map((y) => (
        <Box key={y} x={33.5} y={y} w={65} h={3.4} fill={added} />
      ))}
      {[35, 39, 43, 47, 51].map((y) => (
        <Box
          key={`t${y}`}
          x={44}
          y={y + 1.1}
          w={y === 47 ? 30 : 44}
          h={1.2}
          fill={p.strong}
          rx={0.6}
        />
      ))}
      <Box x={44} y={57} w={50} h={14} fill={p.rule} rx={1.2} />
      <Box x={44.5} y={57.5} w={49} h={13} fill={p.canvas} rx={1} />
      <Box x={47} y={60} w={24} h={1.4} fill={p.muted} rx={0.7} />
      <Box x={47} y={64} w={40} h={1.4} fill={p.strong} rx={0.7} />
      {/* The merge box. */}
      <Box x={104} y={27} w={26} h={8} fill={p.surface} rx={1} />
      <Box x={104} y={39} w={26} h={40} fill={p.text} rx={1.5} />
      <Box x={107} y={43} w={14} h={2} fill={p.canvas} rx={1} />
      <Box x={107} y={50} w={20} h={0.8} fill={p.muted} />
      <Box x={107} y={47} w={0.8} h={4} fill={p.accent} />
      <Box x={107} y={47} w={14} h={0.8} fill={p.accent} />
      <Box x={107} y={66} w={20} h={6} fill={p.accent} rx={1} />
    </>
  );
};

export default thumbnail;
