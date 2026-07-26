import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// 与工具测试图同一套渐变配色，横竖比例混排
const CARDS = [
  { ar: 2 / 3, c1: "#3D5A3C", c2: "#A3C4A8" },
  { ar: 3 / 2, c1: "#8C5E58", c2: "#D9B08C" },
  { ar: 1, c1: "#5A4A3C", c2: "#C4B0A0" },
  { ar: 2 / 3, c1: "#4A3C5A", c2: "#B0A0C4" },
  { ar: 3 / 2, c1: "#2E5266", c2: "#6E8898" },
];

type Cell = { x: number; y: number; w: number; h: number; card: (typeof CARDS)[0] };

// 与工具同源的杂志式等高行布局（简化：固定 3+2 两行，逐行居中）
function layout(W: number, H: number, margin: number, gap: number): Cell[] {
  const rowsDef = [CARDS.slice(0, 3), CARDS.slice(3)];
  const innerW = W - margin * 2;
  const innerH = H - margin * 2;
  const rows = rowsDef.map((r) => {
    const sumAR = r.reduce((a, c) => a + c.ar, 0);
    return { r, h: (innerW - gap * (r.length - 1)) / sumAR };
  });
  const totalH = rows.reduce((a, x) => a + x.h, 0) + gap * (rows.length - 1);
  const f = Math.min(1, innerH / totalH);
  const cells: Cell[] = [];
  let y = margin + (innerH - totalH * f) / 2;
  for (const { r, h } of rows) {
    const rowW = r.reduce((a, c) => a + c.ar * h * f, 0) + gap * (r.length - 1);
    let x = margin + (innerW - rowW) / 2;
    for (const card of r) {
      const w = card.ar * h * f;
      cells.push({ x, y, w, h: h * f, card });
      x += w + gap;
    }
    y += h * f + gap;
  }
  return cells;
}

export const CollageDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const cells = layout(width, height, 30, 10);

  // 结尾渐隐，GIF 循环衔接更顺
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ background: "#f5f1e8" }}>
      <AbsoluteFill style={{ opacity: fadeOut }}>
        {cells.map((cell, i) => {
          const start = 6 + i * 11;
          const s = spring({
            frame: frame - start,
            fps,
            config: { damping: 13, mass: 0.7 },
          });
          const ty = interpolate(s, [0, 1], [52, 0]);
          const rot = interpolate(s, [0, 1], [i % 2 === 0 ? -5 : 5, 0]);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: cell.x,
                top: cell.y,
                width: cell.w,
                height: cell.h,
                transform: `translateY(${ty}px) rotate(${rot}deg) scale(${0.82 + 0.18 * s})`,
                opacity: s,
                background: `linear-gradient(135deg, ${cell.card.c1}, ${cell.card.c2})`,
                borderRadius: 8,
                border: "4px solid #ffffff",
                boxShadow: "0 6px 16px rgba(0,0,0,.28)",
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 10,
            textAlign: "center",
            fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
            fontSize: 16,
            fontWeight: 600,
            color: "#6b6459",
            opacity: interpolate(frame, [72, 92], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          自由拼图 — 拖进来 · 拼好 · 原画质导出
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
