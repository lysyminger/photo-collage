/* interact.js — 指针交互（选择/移动/缩放/裁切/框内平移/框选）与键盘 */
"use strict";

function mpos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
function hitHandle(l, p) {
  const r = (coarse ? 18 : 9) / scale;
  for (const h of handlePoints(l))
    if (Math.abs(p.x - h.px) <= r && Math.abs(p.y - h.py) <= r) return h.id;
  return null;
}
function hitLayer(p) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    if (p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h) return i;
  }
  return -1;
}
// 保证图层至少有 20% 留在画布内，避免被推出去后找不回来
function clampPos(l) {
  l.x = clamp(l.x, -l.w * 0.8, state.W - l.w * 0.2);
  l.y = clamp(l.y, -l.h * 0.8, state.H - l.h * 0.2);
}

stage.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  coarse = e.pointerType === "touch";
  const p = mpos(e);
  const prim = primarySel();
  if (prim) {
    const h = hitHandle(prim, p);
    if (h) {
      drag = { mode: h.length === 2 ? "scale" : "crop", h, p0: p, l: prim, s0: { ...prim }, pushed: false };
      return;
    }
  }
  const i = hitLayer(p);
  if (i >= 0) {
    const l = state.layers[i];
    if (e.ctrlKey || e.metaKey) {
      selection = isSel(l) ? selection.filter(m => m !== l) : [...selection, l];
    } else {
      if (!isSel(l)) selection = [l];      // 点中已选成员则整组一起拖
      drag = {
        mode: (e.altKey || panMode) ? "pan" : "move", p0: p, l, s0: { ...l },
        group: selection.map(m => ({ m, x0: m.x, y0: m.y })),
        pushed: false,
      };
    }
  } else {
    // 空白处按下：开始框选（Shift 在已有选择上追加）
    drag = { mode: "marquee", p0: p, cur: null, base: e.shiftKey ? [...selection] : [], pushed: false };
    if (!e.shiftKey) selection = [];
  }
  updateSelUI(); render();
});

window.addEventListener("pointermove", e => {
  if (!drag) { hoverCursor(e); return; }
  if (!drag.pushed && drag.mode !== "marquee") { pushHistory(); drag.pushed = true; }
  const p = mpos(e), { l, s0, p0 } = drag;
  guides = [];

  if (drag.mode === "move") {
    moveWithSnap(l, s0.x + p.x - p0.x, s0.y + p.y - p0.y);
    const dx = l.x - s0.x, dy = l.y - s0.y;      // 组内其余成员跟随同一位移
    for (const g of drag.group) {
      if (g.m === l) continue;
      g.m.x = g.x0 + dx; g.m.y = g.y0 + dy;
      clampPos(g.m);
    }
  } else if (drag.mode === "scale") {
    scaleCorner(l, s0, drag.h, p);
  } else if (drag.mode === "crop") {
    cropEdge(l, s0, drag.h, p);
  } else if (drag.mode === "pan") {              // pan：只动取景框，不动格子
    const k = s0.w / s0.sw;
    l.sx = clamp(s0.sx - (p.x - p0.x) / k, 0, l.nw - l.sw);
    l.sy = clamp(s0.sy - (p.y - p0.y) / k, 0, l.nh - l.sh);
  } else {                                        // marquee：框选
    drag.cur = p;
    const r = marqueeRect();
    const hits = state.layers.filter(o =>
      o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y);
    selection = [...new Set([...drag.base, ...hits])];
    updateSelUI();
  }
  scheduleRender();
});

function marqueeRect() {
  const a = drag.p0, b = drag.cur;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function endDrag() {
  if (!drag) return;
  drag = null; guides = [];
  updateLayerList(); render();
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", endDrag);

// 双击：照片按当前框的比例居中铺满（裁切填充）
stage.addEventListener("dblclick", e => {
  const p = mpos(e);
  const i = hitLayer(p);
  if (i < 0) return;
  pushHistory();
  selection = [state.layers[i]];
  fillFrame(state.layers[i]);
  updateSelUI(); updateLayerList(); render();
});
function fillFrame(l) {
  const boxAR = l.w / l.h, srcAR = l.nw / l.nh;
  if (srcAR > boxAR) {
    l.sh = l.nh; l.sw = l.nh * boxAR;
    l.sx = (l.nw - l.sw) / 2; l.sy = 0;
  } else {
    l.sw = l.nw; l.sh = l.nw / boxAR;
    l.sx = 0; l.sy = (l.nh - l.sh) / 2;
  }
}

function hoverCursor(e) {
  if (e.target !== cv && e.target !== stage) return;
  const p = mpos(e);
  const sel = primarySel();
  let cur = "default";
  if (sel) {
    const h = hitHandle(sel, p);
    if (h) cur = CURSORS[h];
  }
  if (cur === "default" && hitLayer(p) >= 0) cur = "move";
  stage.style.cursor = cur;
}

function moveWithSnap(l, nx, ny) {
  const thr = 8 / scale;
  // 对齐目标（画布边/中线、邻居三条边）与间距目标分开处理，避免伪吸附点
  const alignX = [0, state.W / 2, state.W], alignY = [0, state.H / 2, state.H];
  const spaceX = [], spaceY = [];
  for (const o of state.layers) {
    if (o === l || isSel(o)) continue;           // 同组成员在移动中，不能作吸附目标
    alignX.push(o.x, o.x + o.w, o.x + o.w / 2);
    alignY.push(o.y, o.y + o.h, o.y + o.h / 2);
    spaceX.push({ pos: o.x - state.gap - l.w, line: o.x - state.gap },
                { pos: o.x + o.w + state.gap, line: o.x + o.w + state.gap });
    spaceY.push({ pos: o.y - state.gap - l.h, line: o.y - state.gap },
                { pos: o.y + o.h + state.gap, line: o.y + o.h + state.gap });
  }
  let bx = null, by = null, bdx = thr, bdy = thr, glx = 0, gly = 0;
  for (const t of alignX) for (const [c, line] of [[t, t], [t - l.w, t], [t - l.w / 2, t]]) {
    const d = Math.abs(nx - c);
    if (d < bdx) { bdx = d; bx = c; glx = line; }
  }
  for (const s of spaceX) {
    const d = Math.abs(nx - s.pos);
    if (d < bdx) { bdx = d; bx = s.pos; glx = s.line; }
  }
  for (const t of alignY) for (const [c, line] of [[t, t], [t - l.h, t], [t - l.h / 2, t]]) {
    const d = Math.abs(ny - c);
    if (d < bdy) { bdy = d; by = c; gly = line; }
  }
  for (const s of spaceY) {
    const d = Math.abs(ny - s.pos);
    if (d < bdy) { bdy = d; by = s.pos; gly = s.line; }
  }
  const sx = bx !== null ? bx : nx, sy = by !== null ? by : ny;
  l.x = sx; l.y = sy;
  clampPos(l);
  if (bx !== null && l.x === sx) guides.push({ v: 1, pos: glx });
  if (by !== null && l.y === sy) guides.push({ v: 0, pos: gly });
}

function scaleCorner(l, s0, hd, p) {
  const anchors = { br: ["x", "y"], bl: ["r", "y"], tr: ["x", "b"], tl: ["r", "b"] };
  const [axk, ayk] = anchors[hd];
  const ax = axk === "x" ? s0.x : s0.x + s0.w;
  const ay = ayk === "y" ? s0.y : s0.y + s0.h;
  // 带符号比例：越过锚点时为负，落到下限而不是反向放大
  const fx = (axk === "x" ? p.x - ax : ax - p.x) / s0.w;
  const fy = (ayk === "y" ? p.y - ay : ay - p.y) / s0.h;
  const minF = 32 / Math.max(s0.w, s0.h);          // 绝对下限约 32 画布单位
  const f = Math.max(minF, fx, fy);
  l.w = s0.w * f; l.h = s0.h * f;
  l.x = axk === "x" ? ax : ax - l.w;
  l.y = ayk === "y" ? ay : ay - l.h;
}

function cropEdge(l, s0, hd, p) {
  const k = s0.w / s0.sw;              // 显示像素 / 原图像素
  const min = 24;                      // 最小尺寸（画布单位）
  if (hd === "r") {
    const lim = (s0.nw - s0.sx) * k;
    const lo = Math.min(min, lim);     // 源图余量不足 24 时以余量为准
    l.w = Math.max(lo, Math.min(p.x - s0.x, lim));
    l.sw = l.w / k;
  } else if (hd === "l") {
    const minX = s0.x + s0.w - (s0.sx + s0.sw) * k;   // sx 减到 0 的极限
    const maxX = s0.x + s0.w - Math.min(min, s0.w);
    const nx = clamp(p.x, minX, maxX);
    const dx = nx - s0.x;
    l.x = nx; l.w = s0.w - dx;
    l.sx = s0.sx + dx / k; l.sw = s0.sw - dx / k;
  } else if (hd === "b") {
    const lim = (s0.nh - s0.sy) * k;
    const lo = Math.min(min, lim);
    l.h = Math.max(lo, Math.min(p.y - s0.y, lim));
    l.sh = l.h / k;
  } else if (hd === "t") {
    const minY = s0.y + s0.h - (s0.sy + s0.sh) * k;
    const maxY = s0.y + s0.h - Math.min(min, s0.h);
    const ny = clamp(p.y, minY, maxY);
    const dy = ny - s0.y;
    l.y = ny; l.h = s0.h - dy;
    l.sy = s0.sy + dy / k; l.sh = s0.sh - dy / k;
  }
  // 收尾统一钳位，杜绝源矩形越界
  l.sw = Math.min(l.sw, l.nw - l.sx);
  l.sh = Math.min(l.sh, l.nh - l.sy);
}

/* ---------- 键盘 ---------- */

window.addEventListener("keydown", e => {
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    e.shiftKey ? redoFn() : undo();
    return;
  }
  if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redoFn(); return; }
  if (mod && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    selection = [...state.layers];
    updateSelUI(); render();
    return;
  }
  if (e.key === "Tab") {
    const n = state.layers.length;
    if (!n) return;
    e.preventDefault();
    const cur = selection.length ? state.layers.indexOf(selection[selection.length - 1]) : -1;
    const next = cur < 0 ? (e.shiftKey ? n - 1 : 0) : (cur + (e.shiftKey ? n - 1 : 1)) % n;
    selection = [state.layers[next]];
    updateSelUI(); render();
    return;
  }
  if (e.key === "Escape") { selection = []; updateSelUI(); render(); return; }

  if (!selection.length) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSel(); return; }
  const step = e.shiftKey ? 10 : 1;
  let dx = 0, dy = 0;
  if (e.key === "ArrowLeft") dx = -step;
  else if (e.key === "ArrowRight") dx = step;
  else if (e.key === "ArrowUp") dy = -step;
  else if (e.key === "ArrowDown") dy = step;
  else return;
  pushHistory("arrow");
  for (const m of selection) { m.x += dx; m.y += dy; clampPos(m); }
  e.preventDefault(); render();
});
