/* Pozadinska slika: veliki profesionalni graf (svijece, EMA, volumen, mreza), crta se na canvas i zamuti */
function drawBackdrop() {
  const cv = document.getElementById("bg"); if (!cv) return;
  const th = document.documentElement.dataset.theme, dark = th !== "light", reel = th === "reel";
  const W = window.innerWidth, H = window.innerHeight, CW = Math.round(W * 1.5), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cv.width = CW * dpr; cv.height = H * dpr; cv.style.width = CW + "px"; cv.style.height = H + "px";
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let s = 20260; const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296, N = () => (R() + R() + R() + R() - 2) * 1.2;
  // podloga
  const bg = g.createLinearGradient(0, 0, CW, H);
  if (reel) { bg.addColorStop(0, "#2a1e16"); bg.addColorStop(.55, "#1d1612"); bg.addColorStop(1, "#33231a"); } else if (dark) { bg.addColorStop(0, "#111114"); bg.addColorStop(1, "#1a1010"); } else { bg.addColorStop(0, "#E9EBEF"); bg.addColorStop(1, "#DDE0E5"); }
  g.fillStyle = bg; g.fillRect(0, 0, CW, H);
  const gridC = reel ? "rgba(255,225,190,.09)" : dark ? "rgba(255,255,255,.07)" : "rgba(30,34,50,.13)", labC = dark ? "rgba(255,255,255,.28)" : "rgba(30,34,50,.34)";
  const up = dark ? "rgba(95,205,135,.50)" : "rgba(30,142,62,.55)", dn = dark ? "rgba(255,110,95,.50)" : "rgba(217,59,48,.52)";
  // mreza
  g.strokeStyle = gridC; g.lineWidth = 1; g.setLineDash([4, 6]);
  const top = H * .10, bot = H * .74;
  for (let i = 0; i <= 8; i++) { const y = top + (bot - top) * i / 8; g.beginPath(); g.moveTo(0, y); g.lineTo(CW, y); g.stroke(); }
  for (let x = 0; x < CW; x += 150) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.setLineDash([]);
  // svijece: nasumicni hod s trendovima
  const step = 24, n = Math.floor(CW / step), cs = []; let p = 100, drift = 0.2;
  for (let i = 0; i < n; i++) { if (i % 28 === 0) drift = (R() - .42) * 1.3; const o = p; p = Math.max(40, p * (1 + (drift * 0.0028 + N() * 0.012))); const c = p;
    cs.push({ o, c, h: Math.max(o, c) * (1 + R() * .008), l: Math.min(o, c) * (1 - R() * .008), v: .3 + R() * .7 + Math.abs(c - o) / o * 25 }); }
  let mn = Math.min(...cs.map(k => k.l)), mx = Math.max(...cs.map(k => k.h)); const Y = v => bot - (v - mn) / (mx - mn) * (bot - top) * .92 - (bot - top) * .04;
  // volumen
  const vb = H * .96, vh = H * .17, vmax = Math.max(...cs.map(k => k.v));
  cs.forEach((k, i) => { g.fillStyle = k.c >= k.o ? up : dn; g.globalAlpha = .55; const h = k.v / vmax * vh; g.fillRect(i * step + 4, vb - h, step - 10, h); }); g.globalAlpha = 1;
  // EMA linije
  const ema = nn => { const kf = 2 / (nn + 1); let e = cs[0].c; return cs.map(k => (e = k.c * kf + e * (1 - kf))); };
  [[ema(12), reel ? "rgba(246,160,77,.7)" : dark ? "rgba(255,190,70,.55)" : "rgba(214,150,30,.55)", 2.2], [ema(40), reel ? "rgba(150,110,235,.6)" : dark ? "rgba(110,150,255,.5)" : "rgba(59,111,212,.45)", 2.2], [ema(90), reel ? "rgba(120,200,150,.5)" : dark ? "rgba(170,120,255,.45)" : "rgba(122,79,208,.38)", 2.2]].forEach(([a, col, w]) => {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); a.forEach((v, i) => i ? g.lineTo(i * step + step / 2, Y(v)) : g.moveTo(step / 2, Y(v))); g.stroke(); });
  // svijece
  cs.forEach((k, i) => { const x = i * step + step / 2, col = k.c >= k.o ? up : dn; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, Y(k.h)); g.lineTo(x, Y(k.l)); g.stroke(); const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); g.fillRect(x - 7, y1, 14, Math.max(2, y2 - y1)); });
  // oznake cijene
  g.font = "600 13px Inter,system-ui"; g.fillStyle = labC; g.textBaseline = "middle";
  for (let i = 0; i <= 8; i++) { const y = top + (bot - top) * i / 8, v = mx - (mx - mn) * ((i / 8) * 1.0); g.fillText((v * 412).toFixed(2), 14, y - 9); g.fillText((v * 412).toFixed(2), CW * .55, y - 9); }
  // svijetla "trenutna cijena" oznaka i nitni kriz
  const lx = CW * .46, ly = Y(cs[Math.floor(lx / step)].c);
  g.strokeStyle = dark ? "rgba(255,255,255,.35)" : "rgba(30,34,50,.35)"; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, H); g.moveTo(0, ly); g.lineTo(CW, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = reel ? "rgba(246,160,77,.95)" : "rgba(232,25,28,.9)"; g.beginPath(); g.arc(lx, ly, 9, 0, 7); g.fill(); g.strokeStyle = dark ? "#111" : "#fff"; g.lineWidth = 3; g.stroke();
  // crveni sjaj u kutu
  const glow = g.createRadialGradient(CW * .72, H * .08, 20, CW * .72, H * .08, H * .75); glow.addColorStop(0, reel ? "rgba(242,138,58,.34)" : "rgba(232,25,28,.30)"); glow.addColorStop(1, reel ? "rgba(242,138,58,0)" : "rgba(232,25,28,0)"); g.fillStyle = glow; g.fillRect(0, 0, CW, H);
  // vinjeta
  const vg = g.createRadialGradient(CW * .4, H * .5, H * .3, CW * .4, H * .5, CW * .6); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, dark ? "rgba(0,0,0,.45)" : "rgba(120,125,140,.22)"); g.fillStyle = vg; g.fillRect(0, 0, CW, H);
}
let _bgT; window.addEventListener("resize", () => { clearTimeout(_bgT); _bgT = setTimeout(drawBackdrop, 250); });
