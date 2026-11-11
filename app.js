'use strict';
/* Color Fun - tiny offline coloring book. No dependencies. */

const SIZES = [8, 18, 34, 60];            // brush widths in image pixels
const DOT_PX = [8, 14, 22, 32];           // size-button dot diameters
const COLORS = [
  '#e53935', '#fb8c00', '#fdd835', '#c0ca33', '#43a047', '#1b5e20', '#00897b', '#4dd0e1', '#29b6f6',
  '#1e88e5', '#283593', '#7e57c2', '#8e24aa', '#d81b60', '#ec407a', '#f8bbd0', '#ffccbc', '#ffcc9c',
  '#d7a86e', '#6d4c41', '#aed581', '#9e9e9e', '#212121', '#ffffff'
];
const MAX_UNDO = 10;
const BARRIER_LUM = 140;                  // pixels darker than this stop the bucket fill

const $ = s => document.querySelector(s);
const canvas = $('#color'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const lineImg = $('#line'), wrap = $('#wrap');

const st = { tool: 'brush', color: COLORS[0], size: 1, name: null, undo: [], redo: [], drawing: false, last: null, saveTimer: 0 };
let W = 1, H = 1, lum = null;

/* ---------- storage (IndexedDB, fails soft) ---------- */
const dbp = new Promise((res, rej) => {
  try {
    const r = indexedDB.open('colorfun', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('art');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  } catch (e) { rej(e); }
});
const dbOp = async (mode, fn) => {
  try {
    const d = await dbp;
    return await new Promise(res => {
      const r = fn(d.transaction('art', mode).objectStore('art'));
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
  } catch (e) { return null; }
};
const dbGet = k => dbOp('readonly', s => s.get(k));
const dbSet = (k, v) => dbOp('readwrite', s => s.put(v, k));
const dbDel = k => dbOp('readwrite', s => s.delete(k));

/* ---------- helpers ---------- */
const imgUrl = n => 'Images/' + encodeURIComponent(n);
const hexRgb = h => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- gallery ---------- */
let thumbUrls = [];
async function showGallery() {
  $('#studio').hidden = true; $('#gallery').hidden = false;
  thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = [];
  let list = [];
  try { list = await (await fetch('Images/manifest.json', { cache: 'no-cache' })).json(); } catch (e) {}
  const grid = $('#grid'); grid.textContent = '';
  $('#empty').hidden = list.length > 0;
  for (const name of list) {
    const b = document.createElement('button'); b.className = 'card'; b.setAttribute('aria-label', 'Color ' + name);
    const im = document.createElement('img'); im.loading = 'lazy'; im.decoding = 'async'; im.alt = '';
    im.src = imgUrl(name);
    b.append(im);
    dbGet(name).then(rec => {                       // show the child's progress if there is any
      if (rec && rec.thumb) { const u = URL.createObjectURL(rec.thumb); thumbUrls.push(u); im.src = u; }
    });
    b.onclick = () => openArt(name);
    grid.append(b);
  }
}

/* ---------- studio ---------- */
async function openArt(name) {
  const token = st.open = (st.open || 0) + 1;     // ignore stale opens if the child taps twice
  st.name = name; st.undo = []; st.redo = [];
  $('#gallery').hidden = true; $('#studio').hidden = false;
  await new Promise(res => { lineImg.onload = lineImg.onerror = res; lineImg.src = imgUrl(name); });
  if (token !== st.open) return;
  W = lineImg.naturalWidth || 1254; H = lineImg.naturalHeight || 1254;
  canvas.width = W; canvas.height = H;
  wrap.style.setProperty('--ar', W / H);
  buildBarrier();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const rec = await dbGet(name);
  if (token !== st.open) return;
  if (rec && rec.blob) {
    try { const bmp = await createImageBitmap(rec.blob); if (bmp.width === W && bmp.height === H) ctx.drawImage(bmp, 0, 0); } catch (e) {}
  }
  updateBtns();
}

function buildBarrier() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(lineImg, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  lum = new Uint8Array(W * H);
  for (let i = 0, p = 0; p < lum.length; p++, i += 4) lum[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
}

function pushUndo() {
  st.undo.push(ctx.getImageData(0, 0, W, H));
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  st.redo = []; updateBtns();
}
function undo() {
  if (!st.undo.length) return;
  st.redo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(st.undo.pop(), 0, 0);
  updateBtns(); scheduleSave();
}
function redo() {
  if (!st.redo.length) return;
  st.undo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(st.redo.pop(), 0, 0);
  updateBtns(); scheduleSave();
}
function updateBtns() { $('#undo').disabled = !st.undo.length; $('#redo').disabled = !st.redo.length; }

/* ---------- drawing ---------- */
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
const paintColor = () => st.tool === 'eraser' ? '#ffffff' : st.color;
function dot(p) {
  ctx.fillStyle = paintColor(); ctx.beginPath(); ctx.arc(p.x, p.y, SIZES[st.size] / 2, 0, 6.2832); ctx.fill();
}
function seg(a, b) {
  ctx.strokeStyle = paintColor(); ctx.lineWidth = SIZES[st.size]; ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

canvas.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  const p = pos(e);
  if (st.tool === 'bucket') { bucket(p.x, p.y); return; }
  pushUndo(); st.drawing = true; st.last = p; dot(p);
});
canvas.addEventListener('pointermove', e => {
  if (!st.drawing) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (evs.length ? evs : [e])) {
    const p = pos(ev); seg(st.last, p); st.last = p;
  }
});
const endStroke = () => { if (st.drawing) { st.drawing = false; scheduleSave(); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- bucket fill ---------- */
function bucket(fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  if (!lum || lum.length !== W * H) buildBarrier();
  const start = y0 * W + x0;
  if (lum[start] < BARRIER_LUM) { toast('Tap inside a shape'); return; }   // tapped on an outline
  pushUndo();
  const img = ctx.getImageData(0, 0, W, H), d = new Uint32Array(img.data.buffer);
  const c = hexRgb(st.color), px = ((255 << 24) | (c.b << 16) | (c.g << 8) | c.r) >>> 0;
  const vis = new Uint8Array(W * H), stack = [start];
  const open = q => lum[q] >= BARRIER_LUM && !vis[q];

  while (stack.length) {                       // scanline flood fill
    const p = stack.pop();
    if (!open(p)) continue;
    const y = (p / W) | 0, row = y * W;
    let l = p - row, r = l;
    while (l > 0 && open(row + l - 1)) l--;
    while (r < W - 1 && open(row + r + 1)) r++;
    for (let i = l; i <= r; i++) { vis[row + i] = 1; d[row + i] = px; }
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      let run = false;
      for (let i = l; i <= r; i++) {
        const q = ny * W + i, ok = open(q);
        if (ok && !run) { stack.push(q); run = true; } else if (!ok) run = false;
      }
    }
  }
  // grow 2px under soft/anti-aliased outline edges so no white halo shows around the lines
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let q = W; q < W * H - W; q++) {
      if (!vis[q] && lum[q] > 40 && (vis[q - 1] || vis[q + 1] || vis[q - W] || vis[q + W])) add.push(q);
    }
    for (const q of add) { vis[q] = 1; d[q] = px; }
  }
  ctx.putImageData(img, 0, 0);
  scheduleSave();
}

/* ---------- save / export ---------- */
function scheduleSave() { clearTimeout(st.saveTimer); st.saveTimer = setTimeout(saveProgress, 700); }
function composite(maxSide) {
  const s = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1;
  const c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(canvas, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'multiply'; x.drawImage(lineImg, 0, 0, c.width, c.height);
  return c;
}
async function saveProgress() {
  clearTimeout(st.saveTimer);
  if (!st.name || $('#studio').hidden) return;
  const blob = await toBlob(canvas, 'image/png');
  const thumb = await toBlob(composite(400), 'image/jpeg', 0.8);
  await dbSet(st.name, { blob, thumb });
}
async function exportPicture() {
  const blob = await toBlob(composite(), 'image/png');
  const file = new File([blob], 'my-coloring.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-coloring.png';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Saved! ⭐');
}

/* ---------- UI wiring ---------- */
const palette = $('#palette');
function setColor(c) {
  st.color = c;
  if (st.tool === 'eraser') setTool('brush');
  palette.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  document.documentElement.style.setProperty('--cur', c === '#ffffff' ? '#bbb' : c);
}
COLORS.forEach(c => {
  const b = document.createElement('button'); b.className = 'sw'; b.style.setProperty('--c', c);
  b.dataset.c = c; b.setAttribute('aria-label', 'color'); b.onclick = () => setColor(c); palette.append(b);
});
{
  const lab = document.createElement('label'); lab.className = 'sw rainbow'; lab.setAttribute('aria-label', 'more colors');
  const inp = document.createElement('input'); inp.type = 'color'; inp.value = '#ff5722';
  inp.oninput = () => setColor(inp.value); lab.append(inp); palette.append(lab);
}
function setTool(t) {
  st.tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  canvas.style.cursor = t === 'bucket' ? 'cell' : 'crosshair';
}
document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));

const sizes = $('#sizes');
SIZES.forEach((_, i) => {
  const b = document.createElement('button'); b.className = 'sz' + (i === st.size ? ' on' : ''); b.setAttribute('aria-label', 'brush size');
  b.innerHTML = '<i style="width:' + DOT_PX[i] + 'px;height:' + DOT_PX[i] + 'px"></i>';
  b.onclick = () => {
    st.size = i; sizes.querySelectorAll('.sz').forEach((x, j) => x.classList.toggle('on', j === i));
    if (st.tool === 'bucket') setTool('brush');
  };
  sizes.append(b);
});

$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#save').onclick = exportPicture;
$('#home').onclick = async () => { await saveProgress(); showGallery(); };
const dlg = $('#confirm');
$('#clear').onclick = () => dlg.showModal();
$('#no').onclick = () => dlg.close();
$('#yes').onclick = () => {
  dlg.close(); pushUndo(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  dbDel(st.name); scheduleSave();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
['gesturestart', 'dblclick'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

setColor(COLORS[0]);
showGallery();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
