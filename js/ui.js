/* ui.js — 图片导入、自动排列、侧栏控件、文件拖放、导出、启动 */
"use strict";

/* ---------- 添加图片 ---------- */

async function makePreview(l, file) {
  if (!("createImageBitmap" in window)) return;
  const LONG = 2048;
  if (Math.max(l.nw, l.nh) <= LONG) return;
  try {
    const r = LONG / Math.max(l.nw, l.nh);
    const bmp = await createImageBitmap(file, {
      resizeWidth: Math.round(l.nw * r),
      resizeHeight: Math.round(l.nh * r),
      resizeQuality: "high",
    });
    l.preview = bmp;
    l.pk = bmp.width / l.nw;
    scheduleRender();
  } catch (e) { /* 预览生成失败则继续用原图绘制 */ }
}

function addFiles(files) {
  const all = [...files];
  const good = all.filter(f => f.type.startsWith("image/"));
  const rejected = all.filter(f => !f.type.startsWith("image/")).map(f => f.name);
  const failed = [];
  if (!good.length) {
    if (rejected.length) toast(`不是浏览器支持的图片格式（HEIC/RAW 请先转 JPG）：${rejected.slice(0, 3).join("、")}${rejected.length > 3 ? "…" : ""}`);
    return;
  }
  pushHistory();
  let pending = good.length;
  const finish = () => {
    if (--pending > 0) return;
    const bad = [...rejected, ...failed];
    if (bad.length) toast(`${bad.length} 个文件无法读取（HEIC/RAW 请先转 JPG）：${bad.slice(0, 3).join("、")}${bad.length > 3 ? "…" : ""}`);
    if (state.layers.length && $("autoOnAdd").checked) autoLayout(false);
    updateSelUI(); updateLayerList(); render();
  };
  for (const f of good) {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const k = Math.min(state.W * 0.45 / nw, state.H * 0.45 / nh);
      const i = state.layers.length;
      const layer = {
        img, preview: null, pk: 1, nw, nh, name: f.name,
        x: 40 + (i % 6) * 36, y: 40 + (i % 6) * 36,
        w: nw * k, h: nh * k,
        sx: 0, sy: 0, sw: nw, sh: nh,
        radius: null, opacity: 1, reflect: false,
      };
      state.layers.push(layer);
      selection = [layer];
      makePreview(layer, f);
      finish();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      failed.push(f.name);
      finish();
    };
    img.src = url;
  }
}

/* ---------- 自动排列（杂志式等高行布局，逐行居中） ---------- */

function autoLayout(pushHist = true) {
  const ls = state.layers;
  if (!ls.length) return toast("先添加照片");
  if (pushHist) pushHistory();
  const gap = state.gap, M = state.margin;
  const W = Math.max(50, state.W - 2 * M), H = Math.max(50, state.H - 2 * M);
  const ar = l => l.sw / l.sh;                     // 保留用户已做的裁切比例
  const totalAR = ls.reduce((a, l) => a + ar(l), 0);
  const targetH = Math.sqrt((W * H) / totalAR);    // 让整体尽量铺满画布

  const rows = [];
  let row = [], sumAR = 0;
  for (const l of ls) {
    row.push(l); sumAR += ar(l);
    if (sumAR * targetH >= W) { rows.push({ row, sumAR }); row = []; sumAR = 0; }
  }
  if (row.length) rows.push({ row, sumAR, last: true });

  let y = 0;
  for (const r of rows) {
    const gaps = gap * (r.row.length - 1);
    let h = (W - gaps) / r.sumAR;
    if (r.last) h = Math.min(h, targetH * 1.15);   // 最后一行不强行拉满
    let x = 0;
    for (const l of r.row) {
      l.x = x; l.y = y; l.h = h; l.w = h * ar(l);
      x += l.w + gap;
    }
    r.rowW = x - gap;
    y += h + gap;
  }
  const totalH = y - gap;

  // 整体缩放到不超出画布；每行各自水平居中，整体垂直居中
  const f = Math.min(1, H / totalH);
  const oy = M + (H - totalH * f) / 2;
  for (const r of rows) {
    const ox = M + (W - r.rowW * f) / 2;
    for (const l of r.row) {
      l.x = l.x * f + ox; l.y = l.y * f + oy;
      l.w *= f; l.h *= f;
    }
  }
  render();
}

/* ---------- 选中图层操作 ---------- */

function updateSelUI() {
  const on = selection.length > 0;
  for (const id of ["upBtn", "downBtn", "resetBtn", "delBtn", "lRadius", "lOpacity", "lReflect", "lStyleReset"])
    $(id).disabled = !on;
  [...$("layerList").children].forEach((c, i) => c.classList.toggle("sel", isSel(state.layers[i])));
  const ref = selection[selection.length - 1];
  if (ref) {
    const r = ref.radius != null ? ref.radius : state.radius;
    $("lRadius").value = r; $("lRadiusV").textContent = r;
    const o = Math.round((ref.opacity != null ? ref.opacity : 1) * 100);
    $("lOpacity").value = o; $("lOpacityV").textContent = o;
    $("lReflect").checked = !!ref.reflect;
  } else {
    $("lRadiusV").textContent = "–";
    $("lOpacityV").textContent = "–";
    $("lReflect").checked = false;
  }
}
function delSel() {
  if (!selection.length) return;
  pushHistory();
  state.layers = state.layers.filter(l => !isSel(l));
  selection = [];
  updateSelUI(); updateLayerList(); render();
}
$("delBtn").onclick = delSel;
$("upBtn").onclick = () => {
  if (!selection.length) return;
  pushHistory();
  const rest = state.layers.filter(l => !isSel(l));
  state.layers = [...rest, ...state.layers.filter(isSel)];
  updateSelUI(); updateLayerList(); render();
};
$("downBtn").onclick = () => {
  if (!selection.length) return;
  pushHistory();
  const rest = state.layers.filter(l => !isSel(l));
  state.layers = [...state.layers.filter(isSel), ...rest];
  updateSelUI(); updateLayerList(); render();
};
$("resetBtn").onclick = () => {
  if (!selection.length) return;
  pushHistory();
  for (const l of selection) {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    // 缩放系数封顶，避免"裁窄条→放大→重置"炸出比画布大好几倍的框
    const k = Math.min(l.w / l.sw, state.W / l.nw, state.H / l.nh);
    l.sx = 0; l.sy = 0; l.sw = l.nw; l.sh = l.nh;
    l.w = l.nw * k; l.h = l.nh * k;
    l.x = cx - l.w / 2; l.y = cy - l.h / 2;
    clampPos(l);
  }
  updateLayerList(); render();
};

// 逐图层样式：圆角覆写 / 透明度 / 倒影
$("lRadius").oninput = () => {
  if (!selection.length) return;
  pushHistory("lstyle");
  const v = +$("lRadius").value;
  $("lRadiusV").textContent = v;
  for (const l of selection) l.radius = v;
  render();
};
$("lOpacity").oninput = () => {
  if (!selection.length) return;
  pushHistory("lstyle");
  const v = +$("lOpacity").value;
  $("lOpacityV").textContent = v;
  for (const l of selection) l.opacity = v / 100;
  render();
};
$("lReflect").onchange = () => {
  if (!selection.length) return;
  pushHistory();
  const on = $("lReflect").checked;
  for (const l of selection) l.reflect = on;
  render();
};
$("lStyleReset").onclick = () => {
  if (!selection.length) return;
  pushHistory();
  for (const l of selection) { l.radius = null; l.opacity = 1; l.reflect = false; }
  updateSelUI(); render();
};
$("panModeBtn").onclick = () => {
  panMode = !panMode;
  $("panModeBtn").textContent = panMode ? "✥ 框内构图模式：开" : "✥ 框内构图模式：关";
  $("panModeBtn").classList.toggle("on", panMode);
  toast(panMode ? "现在拖动照片＝在框内移动画面调构图" : "已回到正常移动模式");
};

/* ---------- 画布设置 ---------- */

const clampSize = v => clamp(Math.round(+v) || 100, 100, 10000);

function setCanvasSize(w, h, remap) {
  w = clampSize(w); h = clampSize(h);
  $("cw").value = w; $("ch").value = h;
  if (w === state.W && h === state.H) return;
  if (remap && state.layers.length) {
    // 按中心等比映射到新画布，避免图层跑到画布外找不回来
    const fw = w / state.W, fh = h / state.H, f = Math.min(fw, fh);
    for (const l of state.layers) {
      const cx = (l.x + l.w / 2) * fw, cy = (l.y + l.h / 2) * fh;
      l.w *= f; l.h *= f;
      l.x = cx - l.w / 2; l.y = cy - l.h / 2;
    }
  }
  state.W = w; state.H = h;
  fitView(); render();
}
$("cw").onchange = $("ch").onchange = () => {
  const w = clampSize($("cw").value), h = clampSize($("ch").value);
  if (w !== state.W || h !== state.H) pushHistory("size");
  $("preset").value = "";
  setCanvasSize(w, h, true);
};
$("preset").onchange = () => {
  const v = $("preset").value;
  if (!v) return;
  const [w, h] = v.split("x").map(Number);
  pushHistory();
  setCanvasSize(w, h, true);
};
$("bg").oninput = () => { pushHistory("bg"); state.bg = $("bg").value; render(); };

// 快捷色板 + 背景图
const SWATCHES = ["#ffffff", "#f5f1e8", "#e8e8e8", "#333333", "#000000"];
for (const c of SWATCHES) {
  const s = document.createElement("span");
  s.style.background = c;
  s.title = c;
  s.onclick = () => { pushHistory("bg"); state.bg = c; $("bg").value = c; render(); };
  $("swatches").appendChild(s);
}
function syncBgUI() {
  $("bgImgClear").disabled = !state.bgImg;
  $("blurRow").style.display = state.bgImg ? "flex" : "none";
}
$("bgImgBtn").onclick = () => $("bgFile").click();
$("bgFile").onchange = e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) return toast("背景图需要是浏览器支持的图片格式（HEIC/RAW 请先转 JPG）");
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = async () => {
    URL.revokeObjectURL(url);
    pushHistory();
    state.bgImg = img;
    state.bgPreview = null;
    if ("createImageBitmap" in window && Math.max(img.naturalWidth, img.naturalHeight) > 2048) {
      try {
        const r = 2048 / Math.max(img.naturalWidth, img.naturalHeight);
        state.bgPreview = await createImageBitmap(f, {
          resizeWidth: Math.round(img.naturalWidth * r),
          resizeHeight: Math.round(img.naturalHeight * r),
          resizeQuality: "high",
        });
      } catch (err) { /* 预览生成失败则用原图 */ }
    }
    syncBgUI(); render();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(`背景图无法读取：${f.name}`); };
  img.src = url;
};
$("bgImgClear").onclick = () => {
  if (!state.bgImg) return;
  pushHistory();
  state.bgImg = null; state.bgPreview = null;
  syncBgUI(); render();
};
$("bgBlur").oninput = () => {
  pushHistory("style");
  state.bgBlur = +$("bgBlur").value;
  $("bgBlurV").textContent = state.bgBlur;
  render();
};

$("fitH").onclick = () => {
  if (!state.layers.length) return toast("先添加照片");
  pushHistory();
  const top = Math.min(...state.layers.map(l => l.y));
  const bottom = Math.max(...state.layers.map(l => l.y + l.h));
  const M = state.margin;
  for (const l of state.layers) l.y += M - top;      // 上下留白 = 边距
  $("preset").value = "";
  setCanvasSize(state.W, bottom - top + 2 * M, false);
};

$("gap").oninput = () => {
  state.gap = +$("gap").value;
  $("gapV").textContent = state.gap;
  if (state.layers.length) { pushHistory("gap"); autoLayout(false); }
};
$("margin").oninput = () => {
  state.margin = +$("margin").value;
  $("marginV").textContent = state.margin;
  if (state.layers.length) { pushHistory("margin"); autoLayout(false); }
};
$("autoBtn").onclick = () => autoLayout();
$("addBtn").onclick = () => $("file").click();
$("file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
$("undoBtn").onclick = undo;
$("redoBtn").onclick = redoFn;

/* ---------- 整体样式 ---------- */

$("border").oninput = () => { pushHistory("style"); state.border = +$("border").value; $("borderV").textContent = state.border; render(); };
$("radius").oninput = () => { pushHistory("style"); state.radius = +$("radius").value; $("radiusV").textContent = state.radius; updateSelUI(); render(); };
$("borderColor").oninput = () => { pushHistory("style"); state.borderColor = $("borderColor").value; render(); };
$("shadowOn").onchange = () => { pushHistory("style"); state.shadowOn = $("shadowOn").checked; render(); };

/* ---------- 拖拽文件（全局兜底，误拖不再导航丢工作） ---------- */

window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); stage.classList.remove("dragover"); dragDepth = 0; });
let dragDepth = 0;
stage.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; stage.classList.add("dragover"); });
stage.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove("dragover"); } });
stage.addEventListener("drop", e => {
  e.preventDefault();
  dragDepth = 0; stage.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
});
window.addEventListener("beforeunload", e => {
  if (state.layers.length) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- 导出 ---------- */

$("fmt").onchange = () => { $("qRow").style.display = $("fmt").value === "jpg" ? "flex" : "none"; };
$("quality").oninput = () => { $("qV").textContent = $("quality").value; };
$("mult").onchange = render;

$("exportBtn").onclick = async () => {
  if (!state.layers.length) return toast("先添加几张照片吧");
  const m = +$("mult").value;
  const outW = state.W * m, outH = state.H * m;
  if (Math.max(outW, outH) > 32767 || outW * outH > 268000000)
    return toast(`导出尺寸 ${outW}×${outH} 超出浏览器上限，请降低倍数或画布尺寸`);
  const btn = $("exportBtn");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "导出中…";
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const g = out.getContext("2d");
    g.imageSmoothingQuality = "high";
    drawBackground(g, m, false);
    for (const l of state.layers) drawLayer(g, l, m, false);   // 导出永远用原图

    const fmt = $("fmt").value;
    const mime = fmt === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise(res => out.toBlob(res, mime, +$("quality").value / 100));
    if (!blob) return toast(`导出失败：画布过大或内存不足（${outW}×${outH}），请降低倍数或尺寸`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const d = new Date(), p2 = n => String(n).padStart(2, "0");
    a.download = `拼图_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${outW}x${outH}.${fmt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已导出 ${a.download}`);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
};

/* ---------- 启动 ---------- */

let rsT;
window.addEventListener("resize", () => {
  clearTimeout(rsT);
  rsT = setTimeout(() => { fitView(); render(); }, 120);
});
syncBgUI();
fitView(); render();
