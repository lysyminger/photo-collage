/* render.js — 视图适配与全部绘制（预览/导出共用） */
"use strict";

function fitView() {
  const pad = Math.min(48, Math.max(14, stage.clientWidth * 0.05));
  const sw = stage.clientWidth - pad, sh = stage.clientHeight - pad;
  scale = Math.min(sw / state.W, sh / state.H, 1.5);
  cv.style.width = state.W * scale + "px";
  cv.style.height = state.H * scale + "px";
  cv.width = Math.round(state.W * scale * dpr);
  cv.height = Math.round(state.H * scale * dpr);
}

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  if (r <= 0) { g.rect(x, y, w, h); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 背景：纯色，或整幅铺满的背景图（可选毛玻璃模糊）
function drawBackground(g, m, usePreview) {
  g.fillStyle = state.bg;
  g.fillRect(0, 0, state.W * m, state.H * m);
  if (!state.bgImg) return;
  const img = usePreview && state.bgPreview ? state.bgPreview : state.bgImg;
  const iw = img.width, ih = img.height;
  const ar = state.W / state.H, iar = iw / ih;
  let sx, sy, sw, sh;                            // cover 式裁切铺满
  if (iar > ar) { sh = ih; sw = ih * ar; sx = (iw - sw) / 2; sy = 0; }
  else { sw = iw; sh = iw / ar; sx = 0; sy = (ih - sh) / 2; }
  g.save();
  g.beginPath();
  g.rect(0, 0, state.W * m, state.H * m);
  g.clip();
  if (state.bgBlur > 0) g.filter = `blur(${state.bgBlur * m}px)`;
  const pad = state.bgBlur * 2 * m;              // 模糊会让边缘透出底色，放大绘制盖住
  g.drawImage(img, sx, sy, sw, sh, -pad, -pad, state.W * m + 2 * pad, state.H * m + 2 * pad);
  g.restore();
}

// 倒影：镜像下延 42% 高度，渐隐到透明（用共享暂存画布合成遮罩）
const reflScratch = document.createElement("canvas");
function drawReflection(g, l, m, usePreview, rad) {
  const x = l.x * m, y = l.y * m;
  const w = Math.max(1, l.w * m), h = Math.max(1, l.h * m);
  const rh = Math.max(1, h * 0.42);
  reflScratch.width = Math.ceil(w);
  reflScratch.height = Math.ceil(rh);
  const og = reflScratch.getContext("2d");
  const src = usePreview && l.preview ? l.preview : l.img;
  const pk = usePreview && l.preview ? l.pk : 1;
  og.save();
  rrect(og, 0, 0, w, rh * 2, rad);               // 只圆可见的上两角
  og.clip();
  og.scale(1, -1);                               // 垂直镜像：暂存 y=0 对应照片底边
  og.drawImage(src, l.sx * pk, l.sy * pk, l.sw * pk, l.sh * pk, 0, -h, w, h);
  og.restore();
  og.globalCompositeOperation = "destination-in";
  const gr = og.createLinearGradient(0, 0, 0, rh);
  gr.addColorStop(0, "rgba(0,0,0,.35)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  og.fillStyle = gr;
  og.fillRect(0, 0, reflScratch.width, reflScratch.height);
  og.globalCompositeOperation = "source-over";
  g.drawImage(reflScratch, x, y + h + 3 * m);
}

// 预览与导出共用的图层绘制：白边为内衬式（不改变照片比例）
// 圆角/透明度/倒影支持逐图层覆写（radius=null 时跟随整体样式）
function drawLayer(g, l, m, usePreview) {
  const x = l.x * m, y = l.y * m, w = l.w * m, h = l.h * m;
  const bw = state.border * m;
  const rad = (l.radius != null ? l.radius : state.radius) * m;
  g.save();
  g.globalAlpha = l.opacity != null ? l.opacity : 1;
  if (l.reflect) drawReflection(g, l, m, usePreview, rad);
  if (state.shadowOn) {
    g.save();
    g.shadowColor = "rgba(0,0,0,.4)";
    g.shadowBlur = 14 * m;
    g.shadowOffsetY = 6 * m;
    g.fillStyle = "#888";
    rrect(g, x, y, w, h, rad);
    g.fill();
    g.restore();
  }
  rrect(g, x, y, w, h, rad);
  g.clip();
  const src = usePreview && l.preview ? l.preview : l.img;
  const pk = usePreview && l.preview ? l.pk : 1;
  g.drawImage(src, l.sx * pk, l.sy * pk, l.sw * pk, l.sh * pk, x, y, w, h);
  if (bw > 0) {
    g.strokeStyle = state.borderColor;
    g.lineWidth = bw * 2;          // 一半被 clip 裁掉，留下 bw 宽的内框
    rrect(g, x, y, w, h, rad);
    g.stroke();
  }
  g.restore();
}

let rafId = 0;
function scheduleRender() {
  if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}

function render() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  drawBackground(ctx, 1, true);
  ctx.imageSmoothingQuality = "high";

  for (const l of state.layers) drawLayer(ctx, l, 1, true);

  // 吸附辅助线
  if (guides.length) {
    ctx.strokeStyle = "#ff5db1";
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    for (const g of guides) {
      ctx.beginPath();
      if (g.v) { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, state.H); }
      else { ctx.moveTo(0, g.pos); ctx.lineTo(state.W, g.pos); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 选中框与手柄（多选：全部描边；手柄只在单选时出现）
  if (selection.length) {
    ctx.strokeStyle = "#5b7cfa";
    ctx.lineWidth = 2 / scale;
    for (const s of selection) ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  const prim = primarySel();
  if (prim) {
    const r = 5 / scale;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#5b7cfa";
    ctx.lineWidth = 1.5 / scale;
    for (const h of handlePoints(prim)) {
      ctx.beginPath();
      if (h.corner) ctx.rect(h.px - r, h.py - r, r * 2, r * 2);
      else ctx.arc(h.px, h.py, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }
  // 框选矩形
  if (drag && drag.mode === "marquee" && drag.cur) {
    const r = marqueeRect();
    ctx.fillStyle = "rgba(91,124,250,.08)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#5b7cfa";
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([5 / scale, 4 / scale]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
  $("empty-tip").style.display = state.layers.length ? "none" : "block";
  $("stat").textContent = `画布 ${state.W}×${state.H} px · ${state.layers.length} 张图` +
    (selection.length > 1 ? ` · 选中 ${selection.length}` : "") + ` · 预览 ${(scale * 100).toFixed(0)}%`;
  $("expSize").textContent = `导出尺寸：${state.W * +$("mult").value}×${state.H * +$("mult").value} px`;
}

function handlePoints(l) {
  const { x, y, w, h } = l;
  return [
    { id: "tl", px: x,       py: y,       corner: 1 }, { id: "tr", px: x + w,   py: y,       corner: 1 },
    { id: "bl", px: x,       py: y + h,   corner: 1 }, { id: "br", px: x + w,   py: y + h,   corner: 1 },
    { id: "t",  px: x + w/2, py: y },                  { id: "b",  px: x + w/2, py: y + h },
    { id: "l",  px: x,       py: y + h/2 },            { id: "r",  px: x + w,   py: y + h/2 },
  ];
}
const CURSORS = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize",
                  t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };

/* ---------- 图层缩略图列表 ---------- */

function updateLayerList() {
  const box = $("layerList");
  box.innerHTML = "";
  state.layers.forEach((l, i) => {
    const c = document.createElement("canvas");
    c.width = 48; c.height = 48;
    if (isSel(l)) c.className = "sel";
    const g = c.getContext("2d");
    g.fillStyle = "#111"; g.fillRect(0, 0, 48, 48);
    const src = l.preview || l.img, pk = l.preview ? l.pk : 1;
    const ar = l.sw / l.sh;
    const dw = ar > 1 ? 48 : 48 * ar, dh = ar > 1 ? 48 / ar : 48;
    g.drawImage(src, l.sx * pk, l.sy * pk, l.sw * pk, l.sh * pk, (48 - dw) / 2, (48 - dh) / 2, dw, dh);
    c.onclick = ev => {
      if (ev.ctrlKey || ev.metaKey) selection = isSel(l) ? selection.filter(m => m !== l) : [...selection, l];
      else selection = [l];
      updateSelUI(); render();
    };
    box.appendChild(c);
  });
}
