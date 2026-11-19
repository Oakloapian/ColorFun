'use strict';
/* Color Fun - tiny offline coloring book. No dependencies. */

const SIZES = [8, 18, 34, 60];            // brush widths in image pixels
const SSIZES = [110, 180, 280, 420];      // sticker sizes in image pixels
const DOT_PX = [8, 14, 22, 32];           // size-button dot diameters
const COLORS = [
  '#e53935', '#fb8c00', '#fdd835', '#c0ca33', '#43a047', '#1b5e20', '#00897b', '#4dd0e1', '#29b6f6',
  '#1e88e5', '#283593', '#7e57c2', '#8e24aa', '#d81b60', '#ec407a', '#f8bbd0', '#ffccbc', '#ffcc9c',
  '#d7a86e', '#6d4c41', '#aed581', '#9e9e9e', '#212121', '#ffffff'
];
const STICKERS = ['⭐', '🌈', '❤️', '☀️', '🌙', '🌸', '🌳',
  '🍎', '🎈', '🎂', '🦋', '🐶', '🐱', '🐼',
  '🦄', '🐠', '🚗', '🚀', '🛸', '🦖', '👑',
  '🎁', '🏆', '💎', '🍦', '⚽', '🎵', '🔥'];
const CAT_INFO = {                         // emoji + tile color per category (unknown folders get a star)
  dinosaurs: ['🦖', '#c5e1a5'], aliens: ['👽', '#b2ebf2'], space: ['🚀', '#d1c4e9'],
  robots: ['🤖', '#bbdefb'], cars: ['🚗', '#ffcdd2'], vehicles: ['🚗', '#ffcdd2'], animals: ['🐶', '#ffe0b2'],
  more: ['⭐', '#fff59d']
};
const MAX_UNDO = 8;
const BARRIER_LUM = 140;                  // pixels darker than this stop the bucket fill
const DONE_AT = 0.9;                      // share of shapes that must be colored to count as finished
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const $ = s => document.querySelector(s);
const canvas = $('#color'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const stk = $('#stk'), sctx = stk.getContext('2d', { willReadFrequently: true });
const lineImg = $('#line'), wrap = $('#wrap');
const LAYERS = { c: ctx, s: sctx };

const st = {
  tool: 'brush', mode: 'paint', color: COLORS[0], size: 1, ssize: 1, name: null, cat: null,
  undo: [], redo: [], drawing: false, last: null, saveTimer: 0, hue: 0, done: false, open: 0
};
let W = 1, H = 1, lum = null, regionIdx = null, LIST = [];

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
const baseName = p => p.split('/').pop();
const dbGetArt = async p => (await dbGet(p)) || (p.includes('/') ? await dbGet(baseName(p)) : null);   // old saves used the bare file name

/* ---------- helpers ---------- */
const imgUrl = p => 'Images/' + p.split('/').map(encodeURIComponent).join('/');
const catOf = p => p.includes('/') ? p.split('/')[0] : 'More';
const hexRgb = h => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}
function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const x = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}

/* ---------- gallery: category buckets -> pictures ---------- */
let thumbUrls = [];
async function loadList() {
  try {
    const j = await (await fetch('Images/manifest.json', { cache: 'no-cache' })).json();
    LIST = Array.isArray(j) ? j : Object.entries(j).flatMap(([k, v]) => v.map(n => k + '/' + n));
  } catch (e) {}
}
async function showGallery() {
  $('#studio').hidden = true; $('#gallery').hidden = false;
  await loadList(); renderGallery();
}
function renderGallery() {
  thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = [];
  const cats = [...new Set(LIST.map(catOf))].sort((a, b) => a === 'More' ? 1 : b === 'More' ? -1 : a.localeCompare(b));
  if (st.cat && !cats.includes(st.cat)) st.cat = null;
  const single = cats.length === 1;
  if (single) st.cat = cats[0];
  $('#crumb').hidden = !st.cat || single;
  $('#catTitle').textContent = st.cat || '';
  $('#empty').hidden = LIST.length > 0;
  const grid = $('#grid'); grid.textContent = '';
  if (!st.cat) {
    for (const cat of cats) {
      const [emoji, tint] = CAT_INFO[cat.toLowerCase()] || CAT_INFO.more;
      const n = LIST.filter(p => catOf(p) === cat).length;
      const b = document.createElement('button'); b.className = 'cat'; b.style.setProperty('--t', tint);
      b.innerHTML = '<span class="em">' + emoji + '</span><span></span><small>' + n + '</small>';
      b.children[1].textContent = cat;
      b.onclick = () => { history.pushState({ v: 'cat' }, ''); st.cat = cat; renderGallery(); window.scrollTo(0, 0); };
      grid.append(b);
    }
    return;
  }
  for (const p of LIST.filter(p => catOf(p) === st.cat)) {
    const b = document.createElement('button'); b.className = 'card'; b.setAttribute('aria-label', 'Color ' + baseName(p));
    const im = document.createElement('img'); im.loading = 'lazy'; im.decoding = 'async'; im.alt = ''; im.src = imgUrl(p);
    b.append(im);
    dbGetArt(p).then(rec => {                         // show the child's progress if there is any
      if (rec && rec.thumb) { const u = URL.createObjectURL(rec.thumb); thumbUrls.push(u); im.src = u; }
    });
    b.onclick = () => { history.pushState({ v: 'art' }, ''); openArt(p); };
    grid.append(b);
  }
}
$('#catBack').onclick = () => { if (histV() === 'cat') history.back(); else { st.cat = null; renderGallery(); } };

/* ---------- studio ---------- */
async function openArt(name) {
  const token = st.open = st.open + 1;               // ignore stale opens if the child taps twice
  st.name = name; st.undo = []; st.redo = []; st.done = false;
  setMode('paint');
  $('#gallery').hidden = true; $('#studio').hidden = false;
  await new Promise(res => { lineImg.onload = lineImg.onerror = res; lineImg.src = imgUrl(name); });
  if (token !== st.open) return;
  W = lineImg.naturalWidth || 1254; H = lineImg.naturalHeight || 1254;
  canvas.width = stk.width = W; canvas.height = stk.height = H;
  wrap.style.setProperty('--ar', W / H);
  buildBarrier(); buildRegions();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  sctx.clearRect(0, 0, W, H);
  const rec = await dbGetArt(name);
  if (token !== st.open) return;
  if (rec) {
    for (const [blob, c] of [[rec.blob, ctx], [rec.stk, sctx]]) {
      if (!blob) continue;
      try { const bmp = await createImageBitmap(blob); if (bmp.width === W && bmp.height === H) c.drawImage(bmp, 0, 0); } catch (e) {}
    }
  }
  maybeFinish(true);                                   // already-finished pictures don't replay the sound
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

/* Scanline flood fill over the line-art "open" pixels. Fills `pix` with the region's pixel indexes; returns true if it touches the edge. */
function floodRegion(start, vis, pix) {
  let border = false;
  const stack = [start], open = q => lum[q] >= BARRIER_LUM && !vis[q];
  while (stack.length) {
    const p = stack.pop();
    if (!open(p)) continue;
    const y = (p / W) | 0, row = y * W;
    let l = p - row, r = l;
    while (l > 0 && open(row + l - 1)) l--;
    while (r < W - 1 && open(row + r + 1)) r++;
    if (l === 0 || r === W - 1 || y === 0 || y === H - 1) border = true;
    for (let i = l; i <= r; i++) { vis[row + i] = 1; pix.push(row + i); }
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      let run = false;
      for (let i = l; i <= r; i++) {
        const q = ny * W + i, ok = open(q);
        if (ok && !run) { stack.push(q); run = true; } else if (!ok) run = false;
      }
    }
  }
  return border;
}

/* Work out which shapes count toward "picture finished": skip the outer background and tiny specks. */
function buildRegions() {
  const vis = new Uint8Array(W * H), comps = [], MIN = W * H * 0.001;
  for (let s = 0; s < W * H; s++) {
    if (vis[s] || lum[s] < BARRIER_LUM) continue;
    const pix = [], border = floodRegion(s, vis, pix);
    if (pix.length >= MIN) comps.push({ pix, border });
  }
  let bg = null;
  for (const c of comps) if (c.border && (!bg || c.pix.length > bg.pix.length)) bg = c;
  const keep = comps.filter(c => c !== bg);
  regionIdx = new Int32Array(keep.reduce((n, c) => n + c.pix.length, 0));
  let o = 0; for (const c of keep) for (const q of c.pix) regionIdx[o++] = q;
}
function coverage() {
  if (!regionIdx || !regionIdx.length) return 0;
  const d = new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer);
  let n = 0;
  for (let i = 0; i < regionIdx.length; i++) if (d[regionIdx[i]] !== 0xFFFFFFFF) n++;
  return n / regionIdx.length;
}
function maybeFinish(silent) {
  if (!regionIdx || !regionIdx.length) return;
  const c = coverage();
  if (!st.done && c >= DONE_AT) {
    st.done = true;
    if (!silent) { toast('🎉 Great job!'); window.playFinish && playFinish(catOf(st.name)); }
  } else if (st.done && c < DONE_AT - 0.1) st.done = false;
}

/* ---------- undo / redo (per-layer snapshots) ---------- */
const snap = keys => { const o = {}; for (const k of keys) o[k] = LAYERS[k].getImageData(0, 0, W, H); return o; };
const apply = o => { for (const k in o) LAYERS[k].putImageData(o[k], 0, 0); };
function pushUndo(keys) {
  st.undo.push(snap(keys));
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  st.redo = []; updateBtns();
}
function undo() {
  if (!st.undo.length) return;
  const e = st.undo.pop(); st.redo.push(snap(Object.keys(e))); apply(e);
  updateBtns(); scheduleSave(); maybeFinish(true);
}
function redo() {
  if (!st.redo.length) return;
  const e = st.redo.pop(); st.undo.push(snap(Object.keys(e))); apply(e);
  updateBtns(); scheduleSave(); maybeFinish(true);
}
function updateBtns() { $('#undo').disabled = !st.undo.length; $('#redo').disabled = !st.redo.length; }

/* ---------- drawing ---------- */
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
const isRainbow = () => st.tool !== 'eraser' && st.color === 'rainbow';
const paintColor = () => st.tool === 'eraser' ? '#ffffff' : isRainbow() ? 'hsl(' + (st.hue % 360) + ' 90% 55%)' : st.color;
function dot(p) {
  ctx.fillStyle = paintColor(); ctx.beginPath(); ctx.arc(p.x, p.y, SIZES[st.size] / 2, 0, 6.2832); ctx.fill();
}
function seg(a, b) {
  if (isRainbow()) {                                  // hue slides as you draw; split long jumps so the trail stays smooth
    const dist = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(dist / 10));
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const q = { x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n };
      st.hue += dist / n * 0.5; line(prev, q); prev = q;
    }
    return;
  }
  line(a, b);
}
function line(a, b) {
  ctx.strokeStyle = paintColor(); ctx.lineWidth = SIZES[st.size]; ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

canvas.addEventListener('pointerdown', e => {
  if (e.button > 0 || st.mode !== 'paint') return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  const p = pos(e);
  if (st.tool === 'bucket') { bucket(p.x, p.y); return; }
  pushUndo(['c']); st.drawing = true; st.last = p; st.hue = Math.random() * 360; dot(p);
});
canvas.addEventListener('pointermove', e => {
  if (!st.drawing) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (evs.length ? evs : [e])) {
    const p = pos(ev); seg(st.last, p); st.last = p;
  }
});
const endStroke = () => { if (st.drawing) { st.drawing = false; scheduleSave(); maybeFinish(); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- bucket fill ---------- */
let rbTable = null;
function rainbowTable() {                       // 360 packed ABGR colors, one per hue degree
  if (rbTable) return rbTable;
  rbTable = new Uint32Array(360);
  const f = (n, h) => { const k = (n + h / 30) % 12; return 0.55 - 0.405 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };   // HSL(h, 90%, 55%)
  for (let h = 0; h < 360; h++) {
    const r = Math.round(f(0, h) * 255), g = Math.round(f(8, h) * 255), b = Math.round(f(4, h) * 255);
    rbTable[h] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return rbTable;
}
function bucket(fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  if (!lum || lum.length !== W * H) buildBarrier();
  const start = y0 * W + x0;
  if (lum[start] < BARRIER_LUM) { toast('Tap inside a shape'); return; }   // tapped on an outline
  pushUndo(['c']);
  const img = ctx.getImageData(0, 0, W, H), d = new Uint32Array(img.data.buffer);
  const rb = st.color === 'rainbow';
  const c = hexRgb(rb ? '#000000' : st.color), px = ((255 << 24) | (c.b << 16) | (c.g << 8) | c.r) >>> 0;
  const tbl = rb ? rainbowTable() : null;
  const put = q => { d[q] = rb ? tbl[((((q % W) + ((q / W) | 0)) * 0.3) | 0) % 360] : px; };   // diagonal rainbow bands
  const vis = new Uint8Array(W * H), pix = [];
  floodRegion(start, vis, pix);
  for (const q of pix) put(q);
  // grow 2px under soft/anti-aliased outline edges so no white halo shows around the lines
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let q = W; q < W * H - W; q++) {
      if (!vis[q] && lum[q] > 40 && (vis[q - 1] || vis[q + 1] || vis[q - W] || vis[q + W])) add.push(q);
    }
    for (const q of add) { vis[q] = 1; put(q); }
  }
  ctx.putImageData(img, 0, 0);
  scheduleSave(); maybeFinish();
}

/* ---------- stickers (drag from the tray onto the picture) ---------- */
const ghost = $('#ghost');
function stamp(emoji, p) {
  pushUndo(['s']);
  sctx.font = SSIZES[st.ssize] + 'px ' + EMOJI_FONT; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
  sctx.fillText(emoji, p.x, p.y);
  scheduleSave();
}
function wireDrag(btn, emoji) {
  let active = false, moved = false, sx = 0, sy = 0;
  const moveGhost = ev => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
  btn.addEventListener('pointerdown', ev => {
    ev.preventDefault(); active = true; moved = false; sx = ev.clientX; sy = ev.clientY;
    try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
    const r = canvas.getBoundingClientRect();
    ghost.textContent = emoji; ghost.style.fontSize = (SSIZES[st.ssize] * r.width / W) + 'px';
    moveGhost(ev); ghost.hidden = false;
  });
  btn.addEventListener('pointermove', ev => {
    if (!active) return;
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) moved = true;
    moveGhost(ev);
  });
  const end = ev => {
    if (!active) return;
    active = false; ghost.hidden = true;
    if (ev.type === 'pointercancel') return;
    const r = canvas.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (inside) stamp(emoji, pos(ev));
    else if (!moved) stamp(emoji, { x: W / 2, y: H / 2 });     // a simple tap drops it in the middle
  };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
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
  x.globalCompositeOperation = 'source-over'; x.drawImage(stk, 0, 0, c.width, c.height);
  return c;
}
async function saveProgress() {
  clearTimeout(st.saveTimer);
  if (!st.name || $('#studio').hidden) return;
  const blob = await toBlob(canvas, 'image/png'), stkBlob = await toBlob(stk, 'image/png');
  const thumb = await toBlob(composite(400), 'image/jpeg', 0.8);
  await dbSet(st.name, { blob, stk: stkBlob, thumb });
}
async function exportPicture() {               // downloads the finished picture to the device
  const blob = await toBlob(composite(), 'image/png');
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'color-fun-' + Date.now() + '.png';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Saved! ⭐');
}

/* ---------- UI wiring ---------- */
const palette = $('#palette');
function setColor(c) {
  st.color = c;
  if (st.tool === 'eraser') setTool('brush');
  palette.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === c));
  document.documentElement.style.setProperty('--cur',
    c === 'rainbow' ? 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' : c === '#ffffff' ? '#bbb' : c);
}
COLORS.forEach(c => {
  const b = document.createElement('button'); b.className = 'sw'; b.style.setProperty('--c', c);
  b.dataset.c = c; b.setAttribute('aria-label', 'color'); b.onclick = () => setColor(c); palette.append(b);
});
const rbBtn = document.createElement('button');
rbBtn.className = 'sw rainbow'; rbBtn.dataset.c = 'rainbow'; rbBtn.setAttribute('aria-label', 'rainbow');
rbBtn.onclick = () => setColor('rainbow'); palette.append(rbBtn);

const moreBtn = document.createElement('button');             // "more colors": a simple grid of shades (no sliders)
moreBtn.className = 'sw more'; moreBtn.dataset.c = 'custom'; moreBtn.setAttribute('aria-label', 'more colors');
moreBtn.innerHTML = '<svg><use href="#i-plus"/></svg>';
palette.append(moreBtn);
const moreDlg = $('#more');
{
  const hues = [0, 25, 50, 120, 175, 210, 270, 320], lights = [88, 72, 56, 42, 28];
  const box = $('#shades');
  for (const l of lights) {
    const cols = hues.map(h => hsl2hex(h, 80, l)).concat([hsl2hex(0, 0, l === 88 ? 95 : l === 72 ? 75 : l === 56 ? 55 : l === 42 ? 35 : 15)]);
    for (const col of cols) {
      const b = document.createElement('button'); b.style.setProperty('--c', col); b.setAttribute('aria-label', 'shade');
      b.onclick = () => { moreBtn.dataset.c = col; moreBtn.style.setProperty('--c', col); moreDlg.close(); setColor(col); };
      box.append(b);
    }
  }
}
moreBtn.onclick = () => moreDlg.showModal();
$('#moreClose').onclick = () => moreDlg.close();

function setTool(t) {
  st.tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  canvas.style.cursor = t === 'bucket' ? 'cell' : 'crosshair';
}
document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));

const sizes = $('#sizes');
function renderSizes() {
  const cur = st.mode === 'stickers' ? st.ssize : st.size;
  sizes.querySelectorAll('.sz').forEach((x, j) => x.classList.toggle('on', j === cur));
}
DOT_PX.forEach((_, i) => {
  const b = document.createElement('button'); b.className = 'sz'; b.setAttribute('aria-label', 'size');
  b.innerHTML = '<i style="width:' + DOT_PX[i] + 'px;height:' + DOT_PX[i] + 'px"></i>';
  b.onclick = () => {
    if (st.mode === 'stickers') st.ssize = i; else { st.size = i; if (st.tool === 'bucket') setTool('brush'); }
    renderSizes();
  };
  sizes.append(b);
});
renderSizes();

function setMode(m) {
  st.mode = m;
  $('#studio').classList.toggle('stickers', m === 'stickers');
  $('#mPaint').classList.toggle('on', m === 'paint');
  $('#mStick').classList.toggle('on', m === 'stickers');
  renderSizes();
}
$('#mPaint').onclick = () => setMode('paint');
$('#mStick').onclick = () => setMode('stickers');
STICKERS.forEach(e => {
  const b = document.createElement('button'); b.className = 'stkbtn'; b.textContent = e; b.setAttribute('aria-label', 'sticker');
  wireDrag(b, e); $('#stickers').append(b);
});

$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#save').onclick = exportPicture;
$('#home').onclick = async () => { if (histV() === 'art') history.back(); else { await saveProgress(); showGallery(); } };
const dlg = $('#confirm');
$('#clear').onclick = () => dlg.showModal();
$('#no').onclick = () => dlg.close();
$('#yes').onclick = () => {
  dlg.close(); pushUndo(['c', 's']);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); sctx.clearRect(0, 0, W, H);
  st.done = false; scheduleSave();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
document.addEventListener('pointerdown', () => { window.unlockAudio && unlockAudio(); });   // browsers only allow sound after a tap
['gesturestart', 'dblclick'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

setColor(COLORS[0]);
showGallery();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

/* Refresh: drop cached copies and reload so new app versions and pictures show up right away (progress is kept). */
$('#refresh').onclick = async () => {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) {}
  location.reload();
};
/* When a new version takes over while the gallery is showing, reload once so it's used immediately. */
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!$('#gallery').hidden) location.reload(); });
}

/* Phone swipe-back / system back: step back one screen (picture -> category -> home) instead of leaving the app. */
function histV() { return (history.state && history.state.v) || 'home'; }
history.replaceState({ v: 'home' }, '');
addEventListener('popstate', async () => {
  const v = histV();
  if (v === 'art') return;
  if (!$('#studio').hidden) await saveProgress();
  if (v === 'home') st.cat = null;
  showGallery();
});
