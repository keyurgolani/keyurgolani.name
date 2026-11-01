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
// The session: the main pane's prompt lines, `whoami` with the headline, its comment lines
// and the field list, `cd ~/work` and a listing over the plate; the index docked on the
// right, its current row lit; and the tmux status line across the foot.
const thumbnail: StudioThumbnail = (p) => {
  const plate = mix(p.secondary, p.text, 0.55);
  const lit = mix(p.accent, p.canvas, 0.6);
  const onBar = shade(p.accent, 0.6);
  const prompt = (x: number, y: number, command: number, where = 0) => (
    <>
      <Box x={x} y={y} w={14} h={1.4} fill={p.secondary} rx={0.3} />
      {where ? <Box x={x + 15} y={y} w={where} h={1.4} fill={p.secondary} rx={0.3} /> : null}
      <Box x={x + 15.6 + where} y={y} w={1} h={1.4} fill={p.muted} />
      <Box x={x + 18 + where} y={y} w={command} h={1.4} fill={p.strong} rx={0.3} />
    </>
  );
  return (
    <>
      <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
      {prompt(3, 3, 6)}
      <Box x={3} y={5.8} w={10} h={1.4} fill={p.secondary} rx={0.3} />
      <Headline x={3} y={13.4} size={5.8} fill={p.text} w={40} />
      {[
        [16, 54],
        [19, 46],
        [22.4, 52],
        [25.2, 18],
      ].map(([y, w], at) => (
        <g key={y}>
          {at % 2 === 0 ? <Box x={3} y={y!} w={1.2} h={1.2} fill={p.muted} /> : null}
          <Box x={5} y={y!} w={w!} h={1.2} fill={at < 2 ? p.text : p.strong} rx={0.3} />
        </g>
      ))}
      <Box x={3} y={28.4} w={11} h={0.3} fill={p.strong} />
      {[16, 9, 14, 17, 11, 20, 18].map((w, at) => (
        <g key={at}>
          {at !== 5 ? (
            <Box x={3} y={31 + at * 2.6} w={6.4} h={1.3} fill={p.secondary} rx={0.3} />
          ) : null}
          <Box
            x={12.6}
            y={31 + at * 2.6}
            w={w}
            h={1.3}
            fill={at === 3 ? p.accent : p.text}
            rx={0.3}
          />
        </g>
      ))}
      <rect
        x={45.6}
        y={30.4}
        width={16.2}
        height={2.6}
        rx={0.8}
        fill={lit}
        stroke={p.secondary}
        strokeWidth={0.3}
      />
      <Box x={47.4} y={31} w={12.6} h={1.3} fill={p.text} rx={0.3} />
      <Box x={65} y={31} w={10} h={1.3} fill={p.text} rx={0.3} />
      {prompt(45.6, 35.6, 3)}
      {[0, 1, 2, 3, 4].map((at) => (
        <g key={at}>
          <Box x={45.6 + at * 7.6} y={38.6} w={5.6} h={1.3} fill={p.accent} rx={0.3} />
          <Box x={45.6 + at * 7.6} y={40.2} w={5.6} h={0.3} fill={p.accent} />
        </g>
      ))}
      {prompt(3, 51.4, 7)}
      <Box x={3} y={56} w={1.2} h={1.2} fill={p.muted} />
      <Box x={5} y={56} w={11} h={1.3} fill={p.text} rx={0.3} />
      {prompt(3, 58.6, 14, 4)}
      <Box x={3} y={61.2} w={7} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={3} y={63.8} w={1} h={1.3} fill={p.secondary} />
      <Box x={5.4} y={63.8} w={6.4} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={16.2} y={63.8} w={19.6} h={1.3} fill={p.text} rx={0.3} />
      <Box x={16.2} y={65.4} w={19.6} h={0.3} fill={p.strong} />
      <Box x={37.6} y={63.8} w={1.2} h={1.2} fill={p.accent} />
      <Box x={83.6} y={63.8} w={7.4} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={16.2} y={66.8} w={32.6} h={15} fill={plate} rx={1.2} />
      {[0, 1, 2, 3].map((at) => (
        <rect
          key={at}
          x={22.6 + at * 2}
          y={69.6 + at * 1}
          width={13}
          height={14}
          rx={0.6}
          fill={tint(p.canvas, 0.4 + at * 0.15)}
          opacity={0.6 + at * 0.13}
        />
      ))}
      {[0, 1, 2, 3].map((at) => (
        <Box key={at} x={30.4} y={74.4 + at * 1.6} w={9.6} h={0.4} fill={p.muted} />
      ))}
      <Box x={94} y={0} w={42} h={80} fill={p.surface} />
      <Box x={94} y={0} w={0.4} h={80} fill={p.rule} />
      <Box x={97} y={3} w={6.4} h={1.4} fill={p.text} rx={0.3} />
      <Box x={124} y={3} w={9} h={1.4} fill={p.strong} rx={0.3} />
      <Box x={97} y={7} w={2} h={1.3} fill={p.secondary} rx={0.3} />
      <Box x={100.4} y={7} w={1} h={1.3} fill={p.text} />
      <Box x={97} y={9.2} w={36} h={2.8} fill={lit} rx={0.8} />
      <Box x={97.6} y={9.8} w={0.6} h={1.6} fill={p.text} />
      <Box x={99.6} y={9.95} w={5} h={1.3} fill={p.strong} rx={0.3} />
      <Box x={106.4} y={9.95} w={10} h={1.3} fill={p.text} rx={0.3} />
      {[6, 8.6, 8, 7, 8.6].map((w, at) => (
        <g key={at}>
          <Box x={97} y={14.4 + at * 3.6} w={w} h={1.3} fill={p.secondary} rx={0.3} />
          <Box x={98.4 + w} y={14.4 + at * 3.6} w={1.2} h={1.3} fill={p.text} />
        </g>
      ))}
      <Box x={97} y={73} w={36} h={0.3} fill={p.rule} />
      <Box x={97} y={75.4} w={1.2} h={1.3} fill={p.secondary} />
      <Box x={100} y={75.4} w={10} h={1.3} fill={p.muted} rx={0.3} />
      <Box x={127} y={75.4} w={6} h={1.3} fill={p.muted} rx={0.3} />
      <Box x={0} y={80} w={136} h={5} fill={p.accent} />
      <Box x={2} y={81.8} w={8} h={1.4} fill={onBar} rx={0.3} />
      {[0, 1, 2, 3, 4].map((at) => (
        <Box
          key={at}
          x={13.4 + at * 9.4}
          y={81.8}
          w={at === 0 ? 5 : 6.6}
          h={1.4}
          fill={onBar}
          rx={0.3}
        />
      ))}
      <Box x={110} y={81.8} w={3.6} h={1.4} fill={onBar} rx={0.3} />
      <rect
        x={115.8}
        y={81.6}
        width={7}
        height={1.8}
        rx={0.9}
        fill="none"
        stroke={onBar}
        strokeWidth={0.3}
      />
      <Box x={124.8} y={81.8} w={2} h={1.4} fill={onBar} rx={0.3} />
      <rect
        x={128.2}
        y={81}
        width={6.4}
        height={3}
        rx={1.5}
        fill="none"
        stroke={onBar}
        strokeWidth={0.35}
      />
      <Box x={129.6} y={81.8} w={3.6} h={1.4} fill={onBar} rx={0.3} />
    </>
  );
};

export default thumbnail;
