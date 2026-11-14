/* Vlastiti graf svijeca na canvasu: svijece, volumen, RSI, MACD, EMA, linije signala i korisnicke linije */
const TF_MS = { "15m": 15 * 60e3, "1h": 3600e3, "4h": 4 * 3600e3, "1D": 86400e3 };

function emaArr(v, n) { const k = 2 / (n + 1), o = []; let e = NaN;
  for (let i = 0; i < v.length; i++) { if (i < n - 1) { o.push(NaN); continue; }
    if (i === n - 1) { e = v.slice(0, n).reduce((a, b) => a + b, 0) / n; } else e = v[i] * k + e * (1 - k); o.push(e); } return o; }
function rsiArr(c, n = 14) { const o = new Array(c.length).fill(NaN); if (c.length <= n) return o;
  let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
function macdArr(c) { const a = emaArr(c, 12), b = emaArr(c, 26), m = c.map((_, i) => a[i] - b[i]);
  const first = m.findIndex(x => !isNaN(x)); const sig = new Array(c.length).fill(NaN);
  if (first >= 0) { const e = emaArr(m.slice(first), 9); e.forEach((x, i) => sig[first + i] = x); }
  return { m, sig, h: m.map((x, i) => x - sig[i]) }; }

class PriceChart {
  constructor(wrap, opts = {}) {
    this.wrap = wrap; this.cv = document.createElement("canvas"); wrap.appendChild(this.cv);
    this.ctx = this.cv.getContext("2d"); this.ov = document.createElement("canvas"); this.ov.className = "ov"; wrap.appendChild(this.ov); this.ovx = this.ov.getContext("2d");
    this.dark = false; this.o = Object.assign({ ema: true, vol: true, rsi: true, macd: true }, opts);
    this.c = []; this.tf = "1h"; this.signals = []; this.lines = []; this.live = NaN;
    this.barW = 9; this.start = 0; this.cross = null; this.addMode = false; this.onAdd = null; this.onHover = null;
    this.drag = null; this.dirty = true; this.axisW = 76; this.axisH = 24;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(wrap);
    const cv = this.cv;
    cv.addEventListener("mousedown", e => { this.drag = { x: e.clientX, s: this.start, moved: false }; });
    window.addEventListener("mouseup", this._up = e => {
      if (this.drag && !this.drag.moved && this.addMode && this.onAdd) {
        const q = this.pos(e), x = q.x, y = q.y;
        if (e.target === cv && x < this.W - this.axisW) { const p = this.yToPrice(y); if (p != null) this.onAdd(p); }
      }
      this.drag = null; cv.style.cursor = this.addMode ? "crosshair" : "default";
    });
    window.addEventListener("mousemove", this._mv = e => {
      const r = cv.getBoundingClientRect();
      if (this.drag) { const dx = e.clientX - this.drag.x; if (Math.abs(dx) > 3) this.drag.moved = true;
        if (this.drag.moved) { this.start = this.drag.s - dx / this.barW; this.clamp(); cv.style.cursor = "grabbing"; this.dirty = true; } }
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        this.cross = this.pos(e); if (this.drag && this.drag.moved) this.dirty = true; this.drawCross(); this.hover();
      } else if (this.cross) { this.cross = null; this.drawCross(); this.hover(); }
    });
    cv.addEventListener("mouseleave", () => { this.cross = null; this.drawCross(); this.hover(); });
    cv.addEventListener("wheel", e => {
      e.preventDefault(); const x = this.pos(e).x;
      const idx = this.start + x / this.barW; const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.barW = Math.min(40, Math.max(2.5, this.barW * f)); this.start = idx - x / this.barW; this.clamp(); this.dirty = true;
    }, { passive: false });
    cv.addEventListener("dblclick", () => { this.reset(); });
    /* os cijene (desno): povuci prstom ili misem gore = povecaj, dolje = smanji (visinski zoom) */
    this.ys = 1; const az = this.az = document.createElement("div"); az.className = "yaxis"; az.style.cssText = "position:absolute;right:0;top:0;width:" + this.axisW + "px;height:60%;z-index:3;touch-action:none;cursor:ns-resize"; wrap.appendChild(az);
    let ya = null; const yset = cy => { this.ys = Math.min(8, Math.max(.12, ya.ys * Math.exp((cy - ya.y) * .006))); this.dirty = true; };
    az.addEventListener("touchstart", e => { if (e.touches.length === 1) ya = { y: e.touches[0].clientY, ys: this.ys }; }, { passive: true });
    az.addEventListener("touchmove", e => { if (ya && e.touches.length === 1) { e.preventDefault(); yset(e.touches[0].clientY); } }, { passive: false });
    az.addEventListener("touchend", () => { ya = null; }, { passive: true });
    az.addEventListener("touchcancel", () => { ya = null; }, { passive: true });
    az.addEventListener("mousedown", e => { ya = { y: e.clientY, ys: this.ys }; e.preventDefault(); });
    window.addEventListener("mousemove", this._ymv = e => { if (ya) yset(e.clientY); });
    window.addEventListener("mouseup", this._yup = () => { ya = null; });
    az.addEventListener("dblclick", () => { this.ys = 1; this.dirty = true; });
    az.addEventListener("wheel", e => { e.preventDefault(); this.ys = Math.min(8, Math.max(.12, this.ys * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); this.dirty = true; }, { passive: false });
    /* dodir: jedan prst povlaci graf, dva prsta zumiraju, dodir postavlja liniju u nacinu "+ Moja linija" */
    let tp = null; const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    cv.addEventListener("touchstart", e => { if (e.touches.length === 2) tp = { pin: dist(e), bw: this.barW, mid: (e.touches[0].clientX + e.touches[1].clientX) / 2, st: this.start };
      else if (e.touches.length === 1) tp = { x: e.touches[0].clientX, s: this.start, moved: false }; }, { passive: true });
    cv.addEventListener("touchmove", e => { if (!tp) return;
      if (tp.pin && e.touches.length === 2) { e.preventDefault(); const r = cv.getBoundingClientRect(), x = (tp.mid - r.left) * (r.width ? this.W / r.width : 1), idx = tp.st + x / tp.bw;
        this.barW = Math.min(40, Math.max(2.5, tp.bw * dist(e) / tp.pin)); this.start = idx - x / this.barW; this.clamp(); this.dirty = true; }
      else if (!tp.pin && e.touches.length === 1) { const dx = e.touches[0].clientX - tp.x; if (Math.abs(dx) > 6) tp.moved = true;
        if (tp.moved) { e.preventDefault(); this.start = tp.s - dx / this.barW; this.clamp(); this.dirty = true; } } }, { passive: false });
    cv.addEventListener("touchend", e => { if (tp && !tp.pin && !tp.moved && this.addMode && this.onAdd && e.changedTouches.length) {
        const q = this.pos(e.changedTouches[0]); if (q.x < this.W - this.axisW) { const p = this.yToPrice(q.y); if (p != null) this.onAdd(p); } }
      if (!e.touches.length) tp = null; }, { passive: true });
    this.loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(this.loop); };
    this.raf = requestAnimationFrame(this.loop); this.resize();
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); window.removeEventListener("mouseup", this._up); window.removeEventListener("mousemove", this._mv); window.removeEventListener("mousemove", this._ymv); window.removeEventListener("mouseup", this._yup); this.cv.remove(); }
  pos(e) { const r = this.cv.getBoundingClientRect(), sx = r.width ? this.W / r.width : 1, sy = r.height ? this.H / r.height : 1; return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }; }
  resize() { const w = this.wrap.clientWidth, h = this.wrap.clientHeight, d = window.devicePixelRatio || 1;
    this.W = w; this.H = h; this.cv.width = w * d; this.cv.height = h * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); this.ov.width = w * d; this.ov.height = h * d; this.ovx.setTransform(d, 0, 0, d, 0, 0); this.dirty = true; }
  setTheme(t) { this.dark = t !== "light"; this.dirty = true; }
  f(a) { return this.dark ? `rgba(244,235,225,${a})` : `rgba(27,27,30,${a})`; }
  k(a) { return this.dark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; }
  get ink() { return this.dark ? "#F4EBE1" : "#1B1B1E"; }
  get inkFg() { return this.dark ? "#1B1B1E" : "#fff"; }
  get UP() { return this.dark ? "#6FD58F" : "#1E8E3E"; }
  get DN() { return this.dark ? "#FF7B70" : "#D93B30"; }
  setOpts(o) { Object.assign(this.o, o); this.dirty = true; }
  setData(c, tf) { this.c = c; this.tf = tf; this.calc(); this.reset(); }
  calc() { const cl = this.c.map(k => k.c);
    this.e20 = emaArr(cl, 20); this.e50 = emaArr(cl, 50); this.e200 = emaArr(cl, 200); this.rsi = rsiArr(cl); this.mc = macdArr(cl); }
  reset() { this.ys = 1; this.barW = 9; const vis = (this.W - this.axisW) / this.barW; this.start = this.c.length - vis + 8; this.clamp(); this.dirty = true; }
  clamp() { const vis = (this.W - this.axisW) / this.barW; this.start = Math.max(-vis * .6, Math.min(this.c.length - vis * .4, this.start)); }
  update(k) { // k: {t,o,h,l,c,v}
    const n = this.c.length; if (!n) return;
    const last = this.c[n - 1];
    if (k.t === last.t) this.c[n - 1] = k; else if (k.t > last.t) { this.c.push(k); if (this.start + (this.W - this.axisW) / this.barW > n - 2) this.start += 1; }
    this.calc(); this.live = k.c; this.dirty = true;
  }
  setLive(p) { this.live = p; this.dirty = true; }
  setSignals(s) { this.signals = s; this.dirty = true; }
  setLines(l) { this.lines = l; this.dirty = true; }
  setAddMode(v) { this.addMode = v; this.cv.style.cursor = v ? "crosshair" : "default"; }
  /* geometrija */
  layout() {
    const o = this.o, plotH = this.H - this.axisH; const w = [{ k: "main", w: 1 }];
    if (o.vol) w.push({ k: "vol", w: .16 }); if (o.rsi) w.push({ k: "rsi", w: .2 }); if (o.macd) w.push({ k: "macd", w: .22 });
    const gap = 6, tot = w.reduce((a, b) => a + b.w, 0), avail = plotH - gap * (w.length - 1); let y = 0; const P = {};
    w.forEach(p => { const h = avail * p.w / tot; P[p.k] = { y, h, min: 0, max: 1 }; y += h + gap; }); return P;
  }
  x(i) { return (i - this.start) * this.barW + this.barW / 2; }
  idxOfTime(t) { const c = this.c; if (!c.length) return NaN; const ms = TF_MS[this.tf];
    if (t <= c[0].t) return (t - c[0].t) / ms; const n = c.length; if (t >= c[n - 1].t) return n - 1 + (t - c[n - 1].t) / ms;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].t <= t) lo = m; else hi = m; } return lo + (t - c[lo].t) / (c[hi].t - c[lo].t); }
  yToPrice(y) { const m = this.P && this.P.main; if (!m || y < m.y || y > m.y + m.h) return null; return m.max - (y - m.y) / m.h * (m.max - m.min); }
  hover() { if (!this.onHover) return; if (!this.cross) { this.onHover(null); return; }
    const i = Math.floor(this.start + this.cross.x / this.barW); this.onHover(this.c[i] ? { k: this.c[i], i } : null); }
  /* crtanje */
  draw() {
    PILL_DARK = !!this.dark; const g = this.ctx, W = this.W, H = this.H; g.clearRect(0, 0, W, H); if (!this.c.length) { g.fillStyle = this.f(.5); g.font = "14px Inter,system-ui"; g.fillText("Učitavanje grafa…", 20, 30); return; }
    const P = this.P = this.layout(), plotW = W - this.axisW, bw = this.barW;
    const i0 = Math.max(0, Math.floor(this.start)), i1 = Math.min(this.c.length - 1, Math.ceil(this.start + plotW / bw));
    /* raspon cijene */
    let mn = Infinity, mx = -Infinity; for (let i = i0; i <= i1; i++) { const k = this.c[i]; if (k.l < mn) mn = k.l; if (k.h > mx) mx = k.h; }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    const openSigs = this.signals.filter(s => s.open);
    const cr = mx - mn;
    openSigs.forEach(s => { [s.stop, s.t1].forEach(v => { if (v < mn) mn = v; if (v > mx) mx = v; }); });
    openSigs.forEach(s => { [s.t2, s.t3].forEach(v => { if (v > mx && v - mn < cr * 2.2) mx = v; }); });
    this.lines.forEach(l => { if (l.price < mn * 1.0 && l.price > mn * .8) mn = l.price; if (l.price > mx && l.price < mx * 1.2) mx = l.price; });
    const pad = (mx - mn) * .06 || mx * .01; P.main.min = mn - pad; P.main.max = mx + pad;
    if (this.ys && this.ys !== 1) { const cc = (P.main.min + P.main.max) / 2, hh = (P.main.max - P.main.min) / 2 * this.ys; P.main.min = cc - hh; P.main.max = cc + hh; }
    if (this.az) { this.az.style.top = P.main.y + "px"; this.az.style.height = P.main.h + "px"; }
    const yP = (p) => P.main.y + (P.main.max - p) / (P.main.max - P.main.min) * P.main.h;
    /* mreza + os cijene */
    g.font = "11px Inter,system-ui"; g.textBaseline = "middle";
    const step = niceStep((P.main.max - P.main.min) / Math.max(3, P.main.h / 70));
    g.strokeStyle = this.k(.06); g.fillStyle = this.f(.6); g.lineWidth = 1;
    for (let p = Math.ceil(P.main.min / step) * step; p < P.main.max; p += step) { const y = Math.round(yP(p)) + .5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.textAlign = "left"; g.fillText(fmtP(p), plotW + 6, y); }
    /* vremenska os */
    this.timeAxis(g, plotW, i0, i1);
    /* signali: zone (iza svijeca) */
    const xr = (t) => this.x(this.idxOfTime(t));
    const sigGeo = this.signals.map(s => { const x0 = Math.max(0, xr(s.start)), x1 = s.end ? Math.min(plotW, xr(s.end)) : plotW; return { s, x0, x1, vis: x1 > 0 && xr(s.start) < plotW }; });
    g.save(); g.beginPath(); g.rect(0, P.main.y, plotW, P.main.h); g.clip();
    sigGeo.forEach(({ s, x0, x1, vis }) => { if (!vis || x1 <= x0) return; const a = s.open ? 1 : .55;
      g.fillStyle = (this.dark ? `rgba(111,213,143,${.10 * a})` : `rgba(30,142,62,${.09 * a})`); g.fillRect(x0, yP(s.t3), x1 - x0, yP(s.entry) - yP(s.t3));
      g.fillStyle = (this.dark ? `rgba(255,123,112,${.12 * a})` : `rgba(217,59,48,${.11 * a})`); g.fillRect(x0, yP(s.entry), x1 - x0, yP(s.stop) - yP(s.entry)); });
    /* EMA */
    if (this.o.ema) [[this.e20, "#E8A317"], [this.e50, "#3B6FD4"], [this.e200, "#7A4FD0"]].forEach(([arr, col]) => {
      g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); let st = false;
      for (let i = i0; i <= i1; i++) { if (isNaN(arr[i])) continue; const x = this.x(i), y = yP(arr[i]); if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); } g.stroke(); });
    /* svijece */
    for (let i = i0; i <= i1; i++) { const k = this.c[i], x = this.x(i), up = k.c >= k.o; const col = up ? this.UP : this.DN;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + .5, yP(k.h)); g.lineTo(Math.round(x) + .5, yP(k.l)); g.stroke();
      const w = Math.max(1, bw * .72), y1 = yP(Math.max(k.o, k.c)), y2 = yP(Math.min(k.o, k.c)); g.fillRect(x - w / 2, y1, w, Math.max(1, y2 - y1)); }
    /* linije signala */
    sigGeo.forEach(({ s, x0, x1, vis }) => { if (!vis) return; const a = s.open ? 1 : .5;
      const L = [["t3", s.t3, this.UP, "T3 · 4R"], ["t2", s.t2, this.UP, "T2 · 3R"], ["t1", s.t1, this.UP, "T1 · 2R"], ["en", s.entry, s.kind === "shadow" ? "#F28A3A" : this.dark ? "#6FD58F" : "#1E8E3E", s.kind === "shadow" ? "Ulaz · sjena" : "Ulaz · pravi"], ["st", s.stop, this.DN, "Stop"]];
      L.forEach(([k, p, col, lab]) => { const y = Math.round(yP(p)) + .5; g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = 1.2; g.setLineDash(k === "en" ? [] : [5, 4]);
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
        if (x1 - x0 > 40) { let txt = lab; if (k === "st") txt = "Stop " + fmtPct((s.stop / s.entry - 1) * 100, 2); pill(g, x0 + 4, y - 9, txt, col, true); } g.globalAlpha = 1; });
      /* oznaka ulaza */
      const ex = xr(s.start); if (ex >= 0 && ex <= plotW) { g.fillStyle = s.kind === "shadow" ? "#F28A3A" : this.dark ? "#6FD58F" : "#1E8E3E"; g.globalAlpha = a; const ey = yP(s.entry); g.beginPath(); g.moveTo(ex, ey + 4); g.lineTo(ex - 5, ey + 12); g.lineTo(ex + 5, ey + 12); g.fill(); g.globalAlpha = 1; }
      /* izlaz */
      if (s.end && s.exitPrice != null) { const xx = xr(s.end); if (xx >= 0 && xx <= plotW) { const yy = yP(s.exitPrice), win = s.rnet > 0.05;
        g.fillStyle = win ? this.UP : s.rnet < -0.05 ? this.DN : "#6E6E74"; g.beginPath(); g.arc(xx, yy, 5, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke();
        pill(g, xx + 8, yy - 8, s.exitLabel, g.fillStyle, false); } }
    });
    /* korisnicke linije */
    this.lines.forEach(l => { const y = Math.round(yP(l.price)) + .5; if (y < P.main.y || y > P.main.y + P.main.h) return;
      g.strokeStyle = "#3B6FD4"; g.lineWidth = 1.2; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]); pill(g, 6, y - 9, l.label || "Moja linija", "#3B6FD4", true); });
    g.restore();
    /* oznake na osi */
    const tags = []; openSigs.forEach(s => { tags.push([s.t3, this.UP, "#fff"], [s.t2, this.UP, "#fff"], [s.t1, this.UP, "#fff"], [s.entry, this.ink, this.inkFg], [s.stop, this.DN, "#fff"]); });
    this.lines.forEach(l => tags.push([l.price, "#3B6FD4", "#fff"]));
    if (!isNaN(this.live)) { const lk = this.c[this.c.length - 1]; tags.push([this.live, lk && lk.c >= lk.o ? this.UP : this.DN, "#fff", true]); }
    tags.forEach(([p, bg, fg, live]) => { const y = yP(p); if (y < P.main.y - 4 || y > P.main.y + P.main.h + 4) return; if (live) { g.strokeStyle = bg; g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y) + .5); g.lineTo(plotW, Math.round(y) + .5); g.stroke(); g.setLineDash([]); }
      g.fillStyle = bg; rr(g, plotW + 2, y - 8, this.axisW - 4, 16, 4); g.fill(); g.fillStyle = fg; g.font = "600 10.5px Inter,system-ui"; g.textAlign = "center"; g.fillText(fmtP(p), plotW + this.axisW / 2, y + .5); });
    /* podpanele */
    this.panes(g, plotW, i0, i1, P);
    this.drawCross();
  }
  drawCross() { const g = this.ovx; if (!g) return; const W = this.W, H = this.H, plotW = W - this.axisW, bw = this.barW; g.clearRect(0, 0, W, H); if (!this.c.length || !this.P) return;
    if (this.cross && this.cross.x < plotW) { const cx = this.cross.x, cy = this.cross.y; g.strokeStyle = this.k(.35); g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(cx) + .5, 0); g.lineTo(Math.round(cx) + .5, H - this.axisH); g.stroke();
      if (cy < H - this.axisH) { g.beginPath(); g.moveTo(0, Math.round(cy) + .5); g.lineTo(plotW, Math.round(cy) + .5); g.stroke(); } g.setLineDash([]);
      const p = this.yToPrice(cy); if (p != null) { g.fillStyle = this.ink; rr(g, plotW + 2, cy - 8, this.axisW - 4, 16, 4); g.fill(); g.fillStyle = this.inkFg; g.font = "600 10.5px Inter,system-ui"; g.textAlign = "center"; g.fillText(fmtP(p), plotW + this.axisW / 2, cy + .5); }
      const idx = Math.floor(this.start + cx / bw), k = this.c[idx]; if (k) { const t = fmtT(k.t); const tw = g.measureText(t).width + 14; g.fillStyle = this.ink; rr(g, Math.min(plotW - tw, Math.max(0, cx - tw / 2)), H - this.axisH + 3, tw, 17, 4); g.fill(); g.fillStyle = this.inkFg; g.textAlign = "center"; g.fillText(t, Math.min(plotW - tw / 2, Math.max(tw / 2, cx)), H - this.axisH + 12); } }
  }
  timeAxis(g, plotW, i0, i1) {
    g.fillStyle = this.f(.55); g.font = "11px Inter,system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    const every = Math.max(1, Math.round(110 / this.barW)); let last = -1e9;
    for (let i = i0; i <= i1; i++) { if (i % every !== 0) continue; const x = this.x(i); if (x < 20 || x > plotW - 20 || x - last < 90) continue; last = x;
      const d = new Date(this.c[i].t), p = new Intl.DateTimeFormat("hr-HR", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d), q = t => p.find(z => z.type === t).value;
      g.fillText(this.tf === "1D" ? `${q("day")}. ${q("month")}.` : `${q("day")}.${q("month")}. ${q("hour")}:${q("minute")}`, x, this.H - this.axisH / 2); }
  }
  panes(g, plotW, i0, i1, P) {
    const lab = (p, t) => { g.fillStyle = this.f(.6); g.font = "600 10.5px Inter,system-ui"; g.textAlign = "left"; g.fillText(t, 6, p.y + 10); };
    const sep = p => { g.strokeStyle = this.k(.08); g.lineWidth = 1; g.beginPath(); g.moveTo(0, p.y - 3 + .5); g.lineTo(plotW + this.axisW, p.y - 3 + .5); g.stroke(); };
    const line = (arr, p, col, w = 1.3) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let st = false;
      for (let i = i0; i <= i1; i++) { if (isNaN(arr[i])) continue; const x = this.x(i), y = p.y + (p.max - arr[i]) / (p.max - p.min) * p.h; if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); } g.stroke(); };
    const axis = (p, vals) => { g.fillStyle = this.f(.5); g.font = "10px Inter,system-ui"; g.textAlign = "left"; vals.forEach(v => { const y = p.y + (p.max - v) / (p.max - p.min) * p.h; g.fillText(v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(+v.toPrecision(3)), plotW + 6, y); }); };
    if (P.vol) { const p = P.vol; sep(p); let mv = 0; for (let i = i0; i <= i1; i++) mv = Math.max(mv, this.c[i].v); p.min = 0; p.max = mv * 1.1 || 1;
      for (let i = i0; i <= i1; i++) { const k = this.c[i], h = k.v / p.max * p.h, x = this.x(i), w = Math.max(1, this.barW * .72); g.fillStyle = k.c >= k.o ? (this.dark ? "rgba(111,213,143,.5)" : "rgba(30,142,62,.5)") : (this.dark ? "rgba(255,123,112,.5)" : "rgba(217,59,48,.5)"); g.fillRect(x - w / 2, p.y + p.h - h, w, h); }
      lab(p, "Volumen"); }
    if (P.rsi) { const p = P.rsi; sep(p); p.min = 0; p.max = 100; g.strokeStyle = this.k(.14); g.setLineDash([3, 3]);
      [30, 70].forEach(v => { const y = Math.round(p.y + (100 - v) / 100 * p.h) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); }); g.setLineDash([]);
      line(this.rsi, p, (this.dark ? "#CFCFD6" : "#55555B")); const lv = this.rsi[Math.min(i1, this.c.length - 1)]; lab(p, "RSI 14" + (isNaN(lv) ? "" : "  " + lv.toFixed(1))); axis(p, [30, 70]); }
    if (P.macd) { const p = P.macd; sep(p); let m = 1e-12; for (let i = i0; i <= i1; i++) [this.mc.m[i], this.mc.sig[i], this.mc.h[i]].forEach(v => { if (!isNaN(v)) m = Math.max(m, Math.abs(v)); });
      p.min = -m * 1.1; p.max = m * 1.1; const y0 = p.y + p.h / 2; g.strokeStyle = this.k(.14); g.beginPath(); g.moveTo(0, Math.round(y0) + .5); g.lineTo(plotW, Math.round(y0) + .5); g.stroke();
      for (let i = i0; i <= i1; i++) { const v = this.mc.h[i]; if (isNaN(v)) continue; const x = this.x(i), w = Math.max(1, this.barW * .6), h = v / p.max * (p.h / 2);
        g.fillStyle = v >= 0 ? (this.dark ? "rgba(111,213,143,.65)" : "rgba(30,142,62,.65)") : (this.dark ? "rgba(255,123,112,.65)" : "rgba(217,59,48,.65)"); g.fillRect(x - w / 2, h >= 0 ? y0 - h : y0, w, Math.abs(h)); }
      line(this.mc.m, p, this.ink); line(this.mc.sig, p, "#E8A317"); lab(p, "MACD 12, 26, 9"); }
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
let PILL_DARK = false;
function pill(g, x, y, text, col, light) { g.font = "600 10px Inter,system-ui"; const w = g.measureText(text).width + 10;
  g.fillStyle = light ? (PILL_DARK ? "rgba(30,26,28,.82)" : "rgba(255,255,255,.88)") : col; rr(g, x, y, w, 15, 4); g.fill(); g.fillStyle = light ? col : "#fff"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(text, x + 5, y + 8); }
function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
