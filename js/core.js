/* core.js — 全局状态、选择集、提示、撤销/重做 */
"use strict";

const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), stage = $("stage");

const state = {
  W: 2160, H: 1620, bg: "#ffffff",
  layers: [],   // {img, preview, pk, nw, nh, name, x, y, w, h, sx, sy, sw, sh, radius, opacity, reflect}
  gap: 24, margin: 0,
  border: 0, borderColor: "#ffffff", radius: 0, shadowOn: false,
  bgImg: null, bgPreview: null, bgBlur: 20,
};
let scale = 1;                       // 画布逻辑单位 → 屏幕像素
let guides = [];                     // 吸附辅助线
let coarse = false;                  // 触屏指针（加大手柄命中区）
let panMode = false;                 // 框内构图模式（触屏没有 Alt 键的替代开关）
let drag = null;
const dpr = window.devicePixelRatio || 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let selection = [];                  // 选中图层（存引用；恰好一个时才显示手柄）
const isSel = l => selection.includes(l);
const primarySel = () => selection.length === 1 ? selection[0] : null;

let toastT;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.style.opacity = 0, 3200);
}

/* ---------- 撤销 / 重做 ---------- */

const histStack = [], redoStack = [];
let lastPush = { tag: null, t: 0 };

function snapshot() {
  return {
    W: state.W, H: state.H, bg: state.bg,
    gap: state.gap, margin: state.margin,
    border: state.border, borderColor: state.borderColor,
    radius: state.radius, shadowOn: state.shadowOn,
    bgImg: state.bgImg, bgPreview: state.bgPreview, bgBlur: state.bgBlur,
    selIdx: selection.map(l => state.layers.indexOf(l)),
    layers: state.layers.map(l => ({ ...l })),
  };
}
// tag 相同且间隔 <600ms 的连续操作（滑块、方向键连按）只记一条
function pushHistory(tag) {
  const now = performance.now();
  if (tag && lastPush.tag === tag && now - lastPush.t < 600) { lastPush.t = now; return; }
  histStack.push(snapshot());
  if (histStack.length > 50) histStack.shift();
  redoStack.length = 0;
  lastPush = { tag: tag || null, t: now };
  updateHistUI();
}
function applySnap(s) {
  Object.assign(state, {
    W: s.W, H: s.H, bg: s.bg, gap: s.gap, margin: s.margin,
    border: s.border, borderColor: s.borderColor, radius: s.radius, shadowOn: s.shadowOn,
    bgImg: s.bgImg, bgPreview: s.bgPreview, bgBlur: s.bgBlur,
  });
  state.layers = s.layers.map(l => ({ ...l }));
  selection = (s.selIdx || []).map(i => state.layers[i]).filter(Boolean);
  $("cw").value = state.W; $("ch").value = state.H; $("bg").value = state.bg;
  $("gap").value = state.gap; $("gapV").textContent = state.gap;
  $("margin").value = state.margin; $("marginV").textContent = state.margin;
  $("border").value = state.border; $("borderV").textContent = state.border;
  $("radius").value = state.radius; $("radiusV").textContent = state.radius;
  $("borderColor").value = state.borderColor; $("shadowOn").checked = state.shadowOn;
  $("bgBlur").value = state.bgBlur; $("bgBlurV").textContent = state.bgBlur;
  $("preset").value = "";
  syncBgUI();
  fitView(); updateSelUI(); updateLayerList(); render();
}
function undo() {
  if (!histStack.length) return;
  redoStack.push(snapshot());
  applySnap(histStack.pop());
  lastPush = { tag: null, t: 0 };
  updateHistUI();
}
function redoFn() {
  if (!redoStack.length) return;
  histStack.push(snapshot());
  applySnap(redoStack.pop());
  updateHistUI();
}
function updateHistUI() {
  $("undoBtn").disabled = !histStack.length;
  $("redoBtn").disabled = !redoStack.length;
}
