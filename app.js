/* Kripto signali – desktop aplikacija */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const S = { rows: [], source: "demo", updated: 0, err: "", prices: {}, open24: {}, tick: 0, ws: null, wsPairs: "" };
let cfg = Object.assign({ token: "", repo: "Tomek0608/crypto-signals", branch: "main", demo: false, refresh: 60 }, lsGet("cfg", {}));
const BINANCE = "https://data-api.binance.vision";
const WSBASE = "wss://data-stream.binance.vision";
const ICON = {
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14" r="1.2"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M16 3.6A9 9 0 0 1 20.4 8H16z"/>',
  cmp: '<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4"/>',
  home: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  sig: '<path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/>',
  chart: '<rect x="5" y="9" width="4" height="7" rx="1"/><rect x="15" y="7" width="4" height="9" rx="1"/><path d="M7 4v16M17 4v16"/>',
  arch: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/>',
  stat: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};
const NAV = [["signali", "Signali: pravi i sjene", "sig", "t"],
  ["moj", "Moj pregled", "wallet", "m"], ["dnevnik", "Moj dnevnik", "book", "m"], ["mojastat", "Moja statistika", "pie", "m"],
  ["pregled", "Pregled signala", "wallet", "s"], ["sdnevnik", "Dnevnik signala", "book", "s"], ["statistika", "Statistika signala", "pie", "s"],
  ["graf", "Graf uživo", "chart", "z"], ["usporedba", "Usporedba: signal i ja", "cmp", "z"], ["arhiva", "Arhiva parova", "arch", "z"],
  ["postavke", "Postavke", "set", "x"]];

/* ---------------- podaci ---------------- */
async function refreshData(quiet) {
  const useDemo = cfg.demo || !cfg.token;
  try {
    if (useDemo) { if (S.source !== "demo" || !S.rows.length) S.rows = await loadDemo(); S.source = "demo"; S.err = ""; }
    else { S.rows = await loadRemote(cfg); S.source = "github"; S.err = ""; }
    S.updated = Date.now();
  } catch (e) { S.err = String(e.message || e); if (!S.rows.length) { S.rows = await loadDemo(); S.source = "demo"; } }
  notifyChanges(); jPull(); syncLive(); if (!quiet || currentView !== "graf") render(); topPills();
}
/* obavijesti: novi signal, zatvoren signal */
function notify(msg) {
  toast(msg);
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Kripto signali", { body: msg, icon: "favicon-256.png" }); } catch (e) {}
  try { document.title = "● " + msg.slice(0, 40); setTimeout(() => { document.title = "Kripto signali"; }, 15000); } catch (e) {}
}
function notifyChanges() {
  if (S.source !== "github") return;
  const prev = lsGet("seenSig", null), cur = {}; S.rows.forEach(r => { cur[r.id] = r.status; });
  if (prev) S.rows.forEach(r => { if (r.status === "skipped_capital") return; const o = prev[r.id], vr = isShadow(r) ? "sjena" : "PRAVI signal";
    if (o === undefined && isOpen(r)) notify(`Novi ${vr}: ${dn(r.pair)}, ulaz ${fmtP(r.entry)}, stop ${fmtP(r.stop)}`);
    else if (o && o !== r.status && isClosed(r)) notify(`Zatvoren (${vr}): ${dn(r.pair)}, ${REASON_TXT[r.reason] || ""} ${fmtR(r.rnet)}`); });
  lsSet("seenSig", cur);
}
function realRows() { return S.rows.filter(s => s.status !== "skipped_capital"); }

/* ---------------- uzivo: cijene ---------------- */
function livePairs() {
  const p = new Set(S.rows.filter(isOpen).map(s => s.pair)); J().filter(jOpen).forEach(t => p.add(t.pair)); if (chartState.pair) p.add(chartState.pair); return [...p];
}
function syncLive() {
  const key = livePairs().sort().join(",");
  if (key === S.wsPairs && S.ws && S.ws.readyState <= 1) return;
  S.wsPairs = key; if (S.ws) { S.ws.onclose = null; try { S.ws.close(); } catch (e) {} }
  if (!key) return;
  const url = WSBASE + "/stream?streams=" + livePairs().map(p => p.toLowerCase() + "@miniTicker").join("/");
  const ws = S.ws = new WebSocket(url);
  ws.onmessage = ev => { try { const d = JSON.parse(ev.data).data; if (!d || !d.s) return;
    S.prices[d.s] = parseFloat(d.c); S.open24[d.s] = parseFloat(d.o); S.tick = Date.now(); paintLive(); } catch (e) {} };
  ws.onclose = () => { S.wsPairs = ""; setTimeout(syncLive, 3000); };
  ws.onerror = () => {};
}
function liveVal(el) {
  const pair = el.dataset.live, p = S.prices[pair]; if (p == null) return;
  const k = el.dataset.k, s = el.dataset.sid ? S.rows.find(x => x.id === el.dataset.sid) : null; let t = "", c = "", c2;
  if (k === "jpl" || k === "jpp") { const tr = J().find(x => x.id === el.dataset.jid); if (tr) { const c = jcalc(tr, p), v = k === "jpl" ? c.total : c.pct; t = k === "jpl" ? jm(v) : fmtPct(v); c2 = cls(v); } }
  else if ((k === "spl" || k === "spp") && el.dataset.sid) { const q = S.rows.find(x => x.id === el.dataset.sid); if (q) { const pc = (p / q.entry - 1) * 100, usd = (q.pnl || 0) + q.pos * (isFinite(q.remaining) ? q.remaining : 1) * (p / q.entry - 1); t = k === "spl" ? jm(usd) : fmtPct(pc); c2 = cls(k === "spl" ? usd : pc); } }
  else if (k === "price") t = fmtP(p);
  else if (k === "pct") { const o = S.open24[pair]; if (o) { const v = (p / o - 1) * 100; t = fmtPct(v); c = cls(v); } }
  else if (s && k === "r") { const r = (p - s.entry) / (s.entry - s.stop); t = fmtR(r); c = cls(r); }
  else if (s && k === "t1") { t = fmtPct((s.t1 / p - 1) * 100); }
  else if (s && k === "st") { t = fmtPct((s.stop / p - 1) * 100); }
  else if (s && k === "state") { const hit = p >= s.t3 ? "T3 dosegnut" : p >= s.t2 ? "T2 dosegnut" : p >= s.t1 ? "T1 dosegnut" : p <= s.stop ? "Ispod stopa" : "U tijeku"; t = hit; c = p <= s.stop ? "down" : p >= s.t1 ? "up" : ""; }
  if (el.textContent !== t) el.textContent = t; if (c2) c = c2; if (c !== undefined && k !== "price") el.className = (el.className.replace(/\b(up|down)\b/g, "").trim() + " " + c).trim();
}
function paintLive() { document.querySelectorAll("[data-live]").forEach(liveVal); if (currentView === "graf" && chart && chartState.pair && S.prices[chartState.pair]) { chart.setLive(S.prices[chartState.pair]); paintChartHead(); } topPills(); }
setInterval(() => topPills(), 2000);

/* ---------------- okvir ---------------- */
let currentView = "", chart = null, kws = null;
function topPills() {
  const el = $("#pills"); if (!el) return;
  const fresh = Date.now() - S.tick < 15000; let h = "";
  h += S.tick ? (fresh ? '<span class="pill live"><span class="dot"></span>Cijene uživo</span>' : '<span class="pill warn"><span class="dot"></span>Veza kasni…</span>') : '<span class="pill warn"><span class="dot"></span>Povezivanje…</span>';
  h += S.source === "demo" ? '<span class="pill demo">Primjer podataka</span>' : `<span class="pill">GitHub · ${S.updated ? fmtHM(S.updated) : "–"}</span>`;
  if (cfg.wtoken) h += S.jerr ? '<span class="pill err" title="' + esc(S.jerr) + '">Dnevnik: nije spremljen</span>' : (S.jsync ? '<span class="pill">Dnevnik spremljen · ' + fmtHM(S.jsync) + "</span>" : '<span class="pill">Dnevnik · provjera…</span>');
  if (S.err) h += `<span class="pill err" title="${esc(S.err)}">Greška podataka</span>`;
  el.innerHTML = h;
}
function shell(title, sub, body) {
  return `<div class="page-head"><h1>${title}</h1><p>${sub || ""}</p></div>${body}`;
}
const THEMES = ["reel", "light", "dark"], THEME_NAME = { reel: "Reel (smeđe staklo)", light: "Svijetla", dark: "Tamna (crvena)" };
const THEME_ICON = { reel: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12.5" cy="7.5" r="1.3"/><circle cx="16" cy="11" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a2 2 0 0 0 0-4"/>' };
const svg = d => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
function setTheme(t) { document.documentElement.dataset.theme = t; lsSet("theme2", t); drawBackdrop(); const b = $("#themebtn"); if (b) b.innerHTML = svg(THEME_ICON.reel) + `<span class="tip">Tema: ${THEME_NAME[t]} (klik za promjenu)</span>`; if (chart) chart.setTheme(t); }
/* uvijek preko cijelog zaslona (i nakon spajanja na drugi monitor) */
function fitScreen() { try { const aw = screen.availWidth, ah = screen.availHeight; if (window.outerWidth < aw - 16 || window.outerHeight < ah - 16) { window.moveTo(screen.availLeft || 0, screen.availTop || 0); window.resizeTo(aw, ah); } } catch (e) {} }
fitScreen(); window.addEventListener("load", () => setTimeout(fitScreen, 300));
function boot() {
  document.documentElement.dataset.theme = lsGet("theme2", "reel");
  $("#root").innerHTML = `<canvas id="bg"></canvas><div class="veil"></div><div class="app"><aside class="rail"><div class="mark">T</div>
    ${NAV.filter(n => n[0] !== "postavke").map(([id, t, ic, g], i, a) => (i && a[i - 1][3] !== g ? '<div class="rsep"></div>' : "") + `<a class="ri g${g}" href="#/${id}" data-nav="${id}">${svg(ICON[ic])}<span class="tip">${t}</span></a>`).join("")}
    <div class="grow"></div><button class="ri" id="themebtn" aria-label="Promijeni temu"></button>
    <a class="ri" href="#/postavke" data-nav="postavke">${svg(ICON.set)}<span class="tip">Postavke</span></a></aside>
    <main class="main" id="main"><div class="topbar"><div class="crumb gl">Kripto signali <span>›</span> <b id="crumb">Pregled</b></div>
      <label class="search gl">${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>').replace("<svg", '<svg width="18" height="18"')}<input id="gsearch" placeholder="Traži par, npr. DODO, pa Enter" autocomplete="off"></label>
      <div class="tb-right"><div class="pills" id="pills"></div><div class="clock gl" id="clock">–</div>
        <a class="ibtn gl" href="#/signali" id="bell" aria-label="Otvoreni signali">${svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 0 0 4 0"/>')}<span class="dot" id="belldot" style="display:none"></span></a>
        <a class="ibtn avatar" href="#/postavke" aria-label="Postavke">TP</a></div></div><div id="page"></div></main></div>`;
  setTheme(lsGet("theme2", "reel")); $("#themebtn").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(document.documentElement.dataset.theme) + 1) % THEMES.length]));
  $("#gsearch").addEventListener("keydown", e => { if (e.key === "Enter") { const v = realSym(e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")); if (v) { location.hash = "#/graf/" + (v.endsWith("USDT") ? v : v + "USDT"); e.target.value = ""; e.target.blur(); } } });
  const tick = () => { const d = new Date(); $("#clock").textContent = new Intl.DateTimeFormat("hr-HR", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); }; tick(); setInterval(tick, 10000);
  window.addEventListener("hashchange", render); render(); refreshData(); setInterval(() => refreshData(true), Math.max(20, cfg.refresh) * 1000);
}
function route() { const h = location.hash.replace(/^#\/?/, "").split("/"); return { view: h[0] || "signali", arg: decodeURIComponent(h[1] || "") }; }
let renderTok = 0;
function render() {
  const { view, arg } = route(); const prev = currentView; const next = NAV.some(n => n[0] === view) ? view : "signali"; const changed = prev !== next && prev !== ""; const page = $("#page"), tok = ++renderTok;
  const go = () => { if (tok !== renderTok) return;
    currentView = next; if (chart && prev === "graf") { chart.destroy(); chart = null; } if (kws) { kws.onclose = null; try { kws.close(); } catch (e) {} kws = null; }
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === currentView)); $("#crumb").textContent = (NAV.find(n => n[0] === currentView) || [])[1];
    const main = $("#main"), sc = main.scrollTop; const V = { moj: vMoj, pregled: vPregled, signali: vSignali, graf: vGraf, arhiva: vArhiva, dnevnik: vDnevnik, statistika: vStatSig, sdnevnik: vSDnevnik, mojastat: vStatMoja, usporedba: vUsporedba, postavke: vPostavke }[currentView];
    page.className = changed || prev === "" ? "enter" : ""; page.innerHTML = V(arg);
    if (page.className === "enter") page.querySelectorAll(".page-head,.chartbar,.card,.item,.chartwrap").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 9)));
    main.scrollTop = prev === currentView ? sc : 0; topPills(); bind(arg); paintLive(); const open = S.rows.some(s => s.status === "open"); const bd = $("#belldot"); if (bd) bd.style.display = open ? "block" : "none"; };
  if (changed && page.innerHTML) { page.classList.remove("enter"); page.classList.add("leaving"); setTimeout(() => { page.classList.remove("leaving"); go(); }, 170); } else go();
}
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4200); }
const kindTag = s => isShadow(s) ? '<span class="tag shadow">Sjena</span>' : '<span class="tag real">Pravi</span>';
/* parovi s kineskim slovima dobivaju latinicno ime */
const ALIAS = lsGet("aliasi", {}), ALIAS0 = { "\u725b\u6765": "NIULAI" };
const aliasOf = b => ALIAS[b] || ALIAS0[b] || ("CN" + [...b].map(c => c.codePointAt(0).toString(16).toUpperCase()).join("").slice(0, 10));
const isLatin = p => /^[\x00-\x7F]*$/.test(p);
const dn = p => { if (isLatin(p)) return p; const b = p.endsWith("USDT") ? p.slice(0, -4) : p; return aliasOf(b) + "USDT"; };
const realSym = v => { if (!isLatin(v)) return v; const all = [...new Set(S.rows.map(s => s.pair))]; const w = v.endsWith("USDT") ? v : v + "USDT"; return all.find(p => !isLatin(p) && dn(p) === w) || v; };
const coin = (p, g) => `<span class="coin ${g ? "g" : ""}"><i>${esc(dn(base(p)).slice(0, 2))}</i>${esc(dn(p))}</span>`;
function statusTag(s) {
  if (s.status === "open") return '<span class="tag open">Otvoren</span>'; if (s.status === "shadow_open") return '<span class="tag open">Sjena · otvorena</span>';
  const t = isNaN(s.rnet) ? "–" : fmtR(s.rnet); return `<span class="tag ${s.rnet > 0.05 ? "win" : s.rnet < -0.05 ? "loss" : ""}">${t}</span>`;
}

/* ---------------- Pregled ---------------- */
function equityCurve(range, custom, base0) {
  const cl = S.rows.filter(s => s.kind === "real" && s.status === "closed").sort((a, b) => a.exit - b.exit);
  let eq = START_EQUITY; const pts = [{ t: (cl[0] ? cl[0].created : Date.now()), v: eq }];
  cl.forEach(s => { eq += s.pnl || 0; pts.push({ t: s.exit, v: eq }); }); pts.push({ t: Date.now(), v: eq });
  if (custom) pts.splice(0, pts.length, ...custom);
  const B0 = base0 == null ? START_EQUITY : base0;
  const lim = range === "7" ? Date.now() - 7 * 864e5 : range === "30" ? Date.now() - 30 * 864e5 : 0;
  let use = pts.filter(p => p.t >= lim); if (use.length < 2) use = pts.slice(-2); if (use.length < 2) return '<div class="empty">Još nema zatvorenih signala.</div>';
  const W = 700, H = 190, pd = 14, t0 = use[0].t, t1 = use[use.length - 1].t || t0 + 1;
  let lo = Math.min(...use.map(p => p.v)), hi = Math.max(...use.map(p => p.v)); if (hi - lo < 1) { hi += 5; lo -= 5; } const sp = (hi - lo) * .12; lo -= sp; hi += sp;
  const X = t => pd + (t - t0) / ((t1 - t0) || 1) * (W - 2 * pd - 40), Y = v => pd + (hi - v) / (hi - lo) * (H - 2 * pd);
  let segs = ""; for (let i = 1; i < use.length; i++) segs += `<path d="M${X(use[i - 1].t).toFixed(1)} ${Y(use[i - 1].v).toFixed(1)} L${X(use[i].t).toFixed(1)} ${Y(use[i].v).toFixed(1)}" style="stroke:${use[i].v >= use[i - 1].v ? "var(--up)" : "var(--down)"}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const area = "M" + use.map(p => `${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" L") + ` L${X(t1).toFixed(1)} ${H} L${X(t0).toFixed(1)} ${H} Z`; const last = use[use.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Kretanje računa"><defs><linearGradient id="ef" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--up);stop-opacity:.2"/><stop offset="1" style="stop-color:var(--up);stop-opacity:0"/></linearGradient></defs>
    <path d="${area}" fill="url(#ef)"/>${segs}<circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="5" style="fill:${last.v >= B0 ? "var(--up)" : "var(--down)"}" stroke="#fff" stroke-width="2"/>
    <g font-size="11" style="fill:var(--faint)"><text x="${W - 4}" y="${Y(hi - sp) + 4}" text-anchor="end">${fmtN(hi - sp, 0)}</text><text x="${W - 4}" y="${Y(lo + sp) + 4}" text-anchor="end">${fmtN(lo + sp, 0)}</text></g></svg>`;
}
let eqRange = lsGet("eqRange", "30");
function vPregled() {
  const rows = realRows(), real = rows.filter(s => s.kind === "real" && s.status === "closed"), eq = equityOf(rows), sm = summarize(real, "rnet");
  const open = rows.filter(s => s.status === "open"), openRisk = open.reduce((a, s) => a + s.risk, 0) / eq * 100;
  const hr = +new Intl.DateTimeFormat("en", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()) % 24, greet = hr < 10 ? "Dobro jutro" : hr < 18 ? "Dobar dan" : "Dobra večer";
  const reasons = {}; real.forEach(s => reasons[s.reason] = (reasons[s.reason] || 0) + 1);
  const rb = ["T3", "stop_na_ulazu", "stop", "isteklo"].map(k => { const n = reasons[k] || 0, pc = real.length ? n / real.length * 100 : 0; const col = k === "stop" ? "var(--down)" : k === "isteklo" ? "var(--gray)" : "var(--up)";
    return `<div class="row-bar"><span>${REASON_TXT[k]}</span><div class="bar"><div style="width:${pc}%;background:${col}"></div></div><b class="r">${pc.toFixed(0)}%</b></div>`; }).join("");
  const avgScore = real.length || open.length ? [...real, ...open].reduce((a, s) => a + s.score, 0) / (real.length + open.length) : NaN;
  const recent = rows.filter(s => s.kind === "real").sort((a, b) => b.created - a.created).slice(0, 8);
  const openT = open.length ? `<table><tr><th>Par</th><th class="r">Cijena uživo</th><th class="r">24h</th><th class="r">Ulaz</th><th class="r">Do T1</th><th class="r">Do stopa</th><th class="r">Uživo R</th><th>Stanje</th></tr>${open.map(s => `<tr class="click" data-go="#/signali/${esc(s.id)}"><td>${coin(s.pair)}</td>
    <td class="r"><b data-live="${s.pair}" data-k="price">–</b></td><td class="r"><span data-live="${s.pair}" data-k="pct">–</span></td><td class="r">${fmtP(s.entry)}</td>
    <td class="r" data-live="${s.pair}" data-k="t1" data-sid="${esc(s.id)}">–</td><td class="r" data-live="${s.pair}" data-k="st" data-sid="${esc(s.id)}">–</td>
    <td class="r"><b data-live="${s.pair}" data-k="r" data-sid="${esc(s.id)}">–</b></td><td><span data-live="${s.pair}" data-k="state" data-sid="${esc(s.id)}">–</span></td></tr>`).join("")}</table>` : '<div class="empty">Trenutno nema otvorenih signala.</div>';
  const sigBody = `
  <div class="grid g4">
    <div class="card hero lift"><div class="sub">Fiktivni račun</div><div class="big">${fmtN(eq)} <span style="font-size:16px;font-weight:500">USDT</span></div><span class="chip">${fmtPct((eq / START_EQUITY - 1) * 100)} od početnih ${fmtN(START_EQUITY, 0)}</span></div>
    <div class="card stat lift"><div class="sub">Stopa pogodaka</div><div class="v">${sm ? sm.win.toFixed(0) + "%" : "–"}</div><div class="sub">${real.length} zatvorenih signala</div></div>
    <div class="card stat lift"><div class="sub">Prosječni R</div><div class="v ${sm ? cls(sm.avg) : ""}">${sm ? fmtR(sm.avg) : "–"}</div><div class="sub">nakon troškova, cilj &gt; 0,2</div></div>
    <div class="card stat lift"><div class="sub">Profit factor</div><div class="v">${sm ? (isFinite(sm.pf) ? fmtN(sm.pf) : "∞") : "–"}</div><div class="sub">cilj &gt; 1,3</div></div>
  </div>
  <div class="card mt"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2>Otvoreni signali · uživo</h2><div class="sub">Cijene se osvježavaju čim stignu s Binancea. R je bruto, bez troškova.</div></div></div>${openT}</div>
  <div class="grid g2 mt">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><h2>Kretanje računa</h2><div class="sub">USDT</div></div>
      <div class="seg" id="eqseg">${[["7", "7D"], ["30", "30D"], ["all", "Sve"]].map(([k, t]) => `<button data-r="${k}" class="${eqRange === k ? "on" : ""}">${t}</button>`).join("")}</div></div><div id="eqchart">${equityCurve(eqRange)}</div></div>
    <div class="card"><h2>Zatvoreno po razlogu</h2><div class="sub">Svi pravi signali</div><div style="margin-top:10px">${rb}</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div><h2>Zadnji signali</h2><div class="sub">Otvoreni i nedavno zatvoreni</div></div><a class="btn" href="#/signali">Svi signali</a></div>
      <table><tr><th>Par</th><th>Vrsta</th><th class="r">Ocjena</th><th class="r">Ulaz</th><th class="r">Stop</th><th>Rezultat</th></tr>${recent.map(s => `<tr class="click" data-go="#/signali/${esc(s.id)}"><td>${coin(s.pair, isShadow(s))}</td><td>${kindTag(s)} <span class="muted">${s.tf}</span></td><td class="r">${s.score}</td><td class="r">${fmtP(s.entry)}</td><td class="r">${fmtP(s.stop)}</td><td>${statusTag(s)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Još nema signala.</td></tr>'}</table></div>
    <div class="card"><div class="kv"><span>Prosječna ocjena signala</span><b>${isNaN(avgScore) ? "–" : avgScore.toFixed(0)}</b></div><div class="note" style="margin:0 0 8px">Prag za slanje je 65</div>
      <div class="kv"><span>Maksimalni pad</span><b>${real.length ? fmtN(maxDD(real, "pnl", START_EQUITY), 1) + "%" : "–"}</b></div>
      <div class="kv"><span>Otvoreni rizik</span><b>${fmtN(openRisk, 1)}% od 4%</b></div>
      <div class="kv"><span>Otvoreni signali</span><b>${open.length}</b></div>
      <div class="kv"><span>Moj stvarni rezultat (dnevnik)</span><a href="#/dnevnik"><b class="${cls(jTotals().total)}">${jm(jTotals().total)} USDT</b></a></div>
      <div class="kv"><span>Zatvorenih do pregleda strategije</span><b>${real.length} / 100</b></div></div>
  </div>`;
  return shell("Pregled signala", `${greet}, Tomislav. Što radi strategija, neovisno o tvojim odlukama. Zadnje osvježavanje u ${S.updated ? fmtHM(S.updated) : "–"}.`, sigBody);
}
function vMoj() {
  const hr = +new Intl.DateTimeFormat("en", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()) % 24, greet = hr < 10 ? "Dobro jutro" : hr < 18 ? "Dobar dan" : "Dobra večer";
  return shell("Moj pregled", `${greet}, Tomislav. Tvoji stvarni trejdovi iz dnevnika. Zadnje osvježavanje u ${S.updated ? fmtHM(S.updated) : "–"}.`, mojPregled());
}
function mojPregled() {
  const a = J(), tt = jTotals(), cl = a.filter(t => !jOpen(t)), op = a.filter(jOpen);
  const cc = cl.map(t => ({ t, c: jcalc(t) })), wins = cc.filter(x => x.c.realized > 0), gw = wins.reduce((s, x) => s + x.c.realized, 0), gl = -cc.filter(x => x.c.realized <= 0).reduce((s, x) => s + x.c.realized, 0);
  const avgPct = cc.length ? cc.reduce((s, x) => s + x.c.pct, 0) / cc.length : NaN;
  const openT = op.length ? `<table><tr><th>Par</th><th>Signal</th><th class="r">Ulaz</th><th class="r">Cijena uživo</th><th class="r">Uloženo</th><th class="r">Zarada USDT</th><th class="r">%</th></tr>${op.map(t => { const sg = S.rows.find(x => x.id === t.sig), c = jcalc(t, S.prices[t.pair]);
    return `<tr class="click" data-go="#/dnevnik"><td>${coin(t.pair)}</td><td>${sg ? kindTag(sg) : '<span class="muted">ručno</span>'}</td><td class="r">${fmtP(t.p)}</td><td class="r"><b data-live="${t.pair}" data-k="price">${S.prices[t.pair] ? fmtP(S.prices[t.pair]) : "–"}</b></td><td class="r">${fmtN(c.rem * t.p)}</td>
    <td class="r"><b class="${cls(c.total)}" data-live="${t.pair}" data-k="jpl" data-jid="${t.id}">${jm(c.total)}</b></td><td class="r"><span class="${cls(c.pct)}" data-live="${t.pair}" data-k="jpp" data-jid="${t.id}">${fmtPct(c.pct)}</span></td></tr>`; }).join("")}</table>` : '<div class="empty">Nemaš otvorenih trejdova. Ulaz upiši u "Moj dnevnik" ili preko gumba na signalu.</div>';
  const recent = [...cc].sort((x, y) => y.t.exits[y.t.exits.length - 1].t - x.t.exits[x.t.exits.length - 1].t).slice(0, 5);
  const recT = recent.length ? `<table><tr><th>Par</th><th>Izlaz</th><th class="r">Cijena izlaza</th><th class="r">Zarada USDT</th><th class="r">%</th></tr>${recent.map(x => `<tr><td>${coin(x.t.pair)}</td><td class="muted">${fmtT(x.t.exits[x.t.exits.length - 1].t)}</td><td class="r">${fmtP(x.c.avgExit)}</td><td class="r ${cls(x.c.realized)}"><b>${jm(x.c.realized)}</b></td><td class="r ${cls(x.c.pct)}">${fmtPct(x.c.pct)}</td></tr>`).join("")}</table>` : '<div class="empty">Još nema zatvorenih trejdova.</div>';
  const st0 = lsGet("mojStart", 0);
  const sorted = [...cc].sort((x, y) => x.t.exits[x.t.exits.length - 1].t - y.t.exits[y.t.exits.length - 1].t);
  let cum = st0 > 0 ? st0 : 0; const first = sorted[0] ? sorted[0].t.t : Date.now(); const pts = [{ t: first, v: cum }]; sorted.forEach(x => { cum += x.c.realized; pts.push({ t: x.t.exits[x.t.exits.length - 1].t, v: cum }); }); pts.push({ t: Date.now(), v: cum });
  let peak = -Infinity, dd = 0; pts.forEach(p => { peak = Math.max(peak, p.v); dd = Math.max(dd, peak - p.v); });
  const dur = cc.length ? cc.reduce((s, x) => s + (x.t.exits[x.t.exits.length - 1].t - x.t.t), 0) / cc.length : NaN;
  const durTxt = isNaN(dur) ? "–" : dur >= 864e5 ? fmtN(dur / 864e5, 1) + " dana" : fmtN(dur / 36e5, 1) + " h";
  const bar = (lab, n, col) => { const pc = cc.length ? n / cc.length * 100 : 0; return `<div class="row-bar"><span>${lab}</span><div class="bar"><div style="width:${pc}%;background:${col}"></div></div><b class="r">${pc.toFixed(0)}%</b></div>`; };
  const nl = cc.length - wins.length;
  return `<div class="grid g4">
    <div class="card hero lift"><div class="sub">Moj račun</div><div class="big">${st0 > 0 ? fmtN(st0 + tt.total) : jm(tt.total)} <span style="font-size:16px;font-weight:500">USDT</span></div><span class="chip">${st0 > 0 ? fmtPct(tt.total / st0 * 100) + " od početnih " + fmtN(st0, 0) : "rezultat · realizirano " + jm(tt.realized) + " · otvoreno " + jm(tt.unreal)}</span><div style="margin-top:10px"><button class="btn sm" id="setstart">${st0 > 0 ? "Promijeni početni račun" : "Postavi početni račun"}</button></div></div>
    <div class="card stat lift"><div class="sub">Stopa pogodaka</div><div class="v">${cc.length ? Math.round(wins.length / cc.length * 100) + "%" : "–"}</div><div class="sub">${cc.length} zatvorenih trejdova</div></div>
    <div class="card stat lift"><div class="sub">Prosjek po trejdu</div><div class="v ${cls(avgPct)}">${cc.length ? fmtPct(avgPct) : "–"}</div><div class="sub">nakon provizije</div></div>
    <div class="card stat lift"><div class="sub">Profit factor</div><div class="v">${cc.length ? (gl > 0 ? fmtN(gw / gl) : gw > 0 ? "∞" : "–") : "–"}</div><div class="sub">dobici / gubici</div></div></div>
  <div class="card mt"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2>Moji otvoreni trejdovi · uživo</h2><div class="sub">Zarada se osvježava čim stigne cijena s Binancea.</div></div><a class="btn" href="#/dnevnik">Moj dnevnik</a></div>${openT}</div>
  <div class="grid g2 mt">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><h2>Kretanje mog računa</h2><div class="sub">USDT, nakon zatvorenih trejdova</div></div>
      <div class="seg" id="eqseg">${[["7", "7D"], ["30", "30D"], ["all", "Sve"]].map(([k, t]) => `<button data-r="${k}" class="${eqRange === k ? "on" : ""}">${t}</button>`).join("")}</div></div><div id="eqchart">${cc.length ? equityCurve(eqRange, pts, st0 > 0 ? st0 : 0) : '<div class="empty">Još nema zatvorenih trejdova.</div>'}</div></div>
    <div class="card"><h2>Zatvoreno po ishodu</h2><div class="sub">Svi moji zatvoreni trejdovi</div><div style="margin-top:10px">${bar("Dobitni", wins.length, "var(--up)")}${bar("Gubitni", nl, "var(--down)")}</div></div></div>
  <div class="grid g2 mt">
    <div class="card"><h2>Moji zadnji zatvoreni trejdovi</h2><div style="margin-top:8px">${recT}</div></div>
    <div class="card"><div class="kv"><span>Prosječno trajanje trejda</span><b>${durTxt}</b></div>
      <div class="kv"><span>Najveći pad rezultata</span><b>${cc.length ? fmtN(dd) + " USDT" : "–"}</b></div>
      <div class="kv"><span>Trenutno uloženo</span><b>${fmtN(tt.inv)} USDT</b></div>
      <div class="kv"><span>Otvoreni trejdovi</span><b>${op.length}</b></div>
      <div class="kv"><span>Zatvoreni trejdovi</span><b>${cc.length}</b></div></div></div>`;
}

/* ---------------- Dnevnik signala (isto sto Moj dnevnik, ali za Telegram signale) ---------------- */
function vSDnevnik() {
  const rows = realRows().filter(s => inRange(s.created)).sort((a, b) => b.created - a.created);
  const pick = s => (sdFilter.f === "pravi" && isReal(s)) || (sdFilter.f === "otvoreni" && s.status === "open") || (sdFilter.f === "zatvoreni" && s.status === "closed") || (sdFilter.f === "sjene" && isShadow(s));
  const cnt = { pravi: rows.filter(isReal).length, otvoreni: rows.filter(s => s.status === "open").length, zatvoreni: rows.filter(s => s.status === "closed").length, sjene: rows.filter(isShadow).length };
  const fl = rows.filter(s => pick(s) && (!sdFilter.q || s.pair.includes(sdFilter.q.toUpperCase()) || dn(s.pair).includes(sdFilter.q.toUpperCase())));
  const real = rows.filter(isReal), cl = real.filter(s => s.status === "closed"), op = real.filter(s => s.status === "open");
  const realized = cl.reduce((a, s) => a + (s.pnl || 0), 0), inv = op.reduce((a, s) => a + s.pos * (isFinite(s.remaining) ? s.remaining : 1), 0);
  const unreal = op.reduce((a, s) => { const p = S.prices[s.pair]; return a + (p ? (s.pnl || 0) + s.pos * (isFinite(s.remaining) ? s.remaining : 1) * (p / s.entry - 1) : (s.pnl || 0)); }, 0);
  const body = fl.map(s => { const o = isOpen(s), c = s.pnl || 0, hasPos = s.pos > 0;
    return `<tr class="click" data-go="#/signali/${esc(s.id)}"><td>${coin(s.pair, isShadow(s))}<div style="margin-top:4px">${kindTag(s)} <span class="muted" style="font-size:12px">${s.tf} · ocjena ${s.score}</span></div></td>
    <td><div><b>${fmtP(s.entry)}</b></div><div class="muted" style="font-size:12px">${fmtT(s.created)}</div></td><td class="r">${hasPos ? fmtN(s.pos) : "–"}</td>
    <td class="r">${o ? `<b data-live="${s.pair}" data-k="price">${S.prices[s.pair] ? fmtP(S.prices[s.pair]) : "–"}</b>` : "–"}</td>
    <td>${o ? '<span class="muted">u tijeku</span>' : `<div><b>${fmtP(sigExitPrice(s))}</b></div><div class="muted" style="font-size:12px">${REASON_TXT[s.reason] || ""} · ${fmtT(s.exit)}</div>`}</td>
    <td class="r">${o ? (isFinite(s.remaining) ? fmtN(s.remaining * 100, 0) + "%" : "100%") : "zatvoreno"}</td>
    <td class="r">${hasPos ? `<b class="${cls(c)}" ${o ? `data-live="${s.pair}" data-k="spl" data-sid="${esc(s.id)}"` : ""}>${jm(c)}</b>` : "–"}</td>
    <td class="r"><span class="${cls(o ? 0 : sigPct(s))}" ${o ? `data-live="${s.pair}" data-k="spp" data-sid="${esc(s.id)}"` : ""}>${o ? "–" : fmtPct(sigPct(s))}</span><div class="muted" style="font-size:12px">${o ? "" : fmtR(s.rnet)}</div></td></tr>`; }).join("");
  return shell("Dnevnik signala", "Svi signali koje je javio Telegram: ulaz, izlaz, cijene i zarada na fiktivnoj poziciji, isto kao tvoj dnevnik. Klik na red otvara cijelu analizu.", dateBar() + `
  <div class="grid g4"><div class="card stat lift"><div class="sub">Realizirano (fiktivno)</div><div class="v ${cls(realized)}">${jm(realized)} <span style="font-size:14px">USDT</span></div><div class="sub">${cl.length} zatvorenih pravih signala</div></div>
    <div class="card stat lift"><div class="sub">Otvoreno uživo</div><div class="v ${cls(unreal)}">${jm(unreal)} <span style="font-size:14px">USDT</span></div><div class="sub">neostvareno</div></div>
    <div class="card stat lift"><div class="sub">Ukupno</div><div class="v ${cls(realized + unreal)}">${jm(realized + unreal)} <span style="font-size:14px">USDT</span></div><div class="sub">realizirano + otvoreno</div></div>
    <div class="card stat lift"><div class="sub">Trenutno uloženo</div><div class="v">${fmtN(inv)} <span style="font-size:14px">USDT</span></div><div class="sub">${op.length} otvorenih signala</div></div></div>
  <div class="card mt"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center" id="sfilter">${[["pravi", "Pravi signali"], ["otvoreni", "Otvoreni"], ["zatvoreni", "Zatvoreni"], ["sjene", "Sjene (probni)"]].map(([k, t]) => `<button class="chip-btn ${sdFilter.f === k ? "on" : ""}" data-f="${k}">${t} (${cnt[k]})</button>`).join("")}<input class="txt sm" id="sq" placeholder="Traži par" value="${esc(sdFilter.q)}" style="margin-left:auto"></div>
    <div style="overflow-x:auto"><table class="cmp"><tr><th>Par</th><th>Ulaz</th><th class="r">Fiktivno USDT</th><th class="r">Uživo</th><th>Izlaz</th><th class="r">Preostalo</th><th class="r">Zarada USDT</th><th class="r">% · R</th></tr>
    ${body || '<tr><td colspan="8" class="empty">Nema signala za taj filtar.</td></tr>'}</table></div></div>`);
}

/* ---------------- Usporedba: signal i ja ---------------- */
function vUsporedba() {
  const pairs = J().map(t => ({ t, sg: S.rows.find(x => x.id === t.sig) })).filter(x => x.sg).sort((a, b) => b.t.t - a.t.t);
  const done = pairs.filter(x => !jOpen(x.t) && isClosed(x.sg)), pend = pairs.filter(x => !(!jOpen(x.t) && isClosed(x.sg)));
  const row = x => { const t = x.t, sg = x.sg, c = jcalc(t, S.prices[t.pair]), fin = !jOpen(t) && isClosed(sg);
    const dIn = (t.p / sg.entry - 1) * 100, sx = sigExitPrice(sg), sp = sigPct(sg), mp = c.pct;
    const myExT = t.exits.length ? t.exits[t.exits.length - 1].t : NaN, dOut = fin ? (c.avgExit / sx - 1) * 100 : NaN;
    const mr = (c.avgExit - t.p) / (sg.entry - sg.stop), dR = fin ? mr - sg.rnet : NaN;
    return { t, sg, c, fin, dIn, sx, sp, mp, myExT, dOut, mr, dR, dPct: fin ? mp - sp : NaN }; };
  const R = done.map(row), n = R.length, sum = k => R.reduce((a, r) => a + (r[k] || 0), 0);
  const cell2 = (a, b) => `<div>${a}</div><div class="muted" style="font-size:12px">${b}</div>`;
  const tbl = rs => rs.map(r => `<tr class="click" data-go="#/signali/${esc(r.sg.id)}"><td>${coin(r.t.pair)}<div style="margin-top:4px">${kindTag(r.sg)}</div></td>
    <td>${cell2("<b>" + fmtP(r.sg.entry) + "</b>", fmtT(r.sg.created))}</td><td class="mine">${cell2("<b>" + fmtP(r.t.p) + "</b>", fmtT(r.t.t))}</td><td class="r ${cls(-r.dIn)}"><b>${fmtPct(r.dIn)}</b></td>
    <td>${r.fin ? cell2("<b>" + fmtP(r.sx) + "</b>", (REASON_TXT[r.sg.reason] || "") + " · " + fmtT(r.sg.exit)) : '<span class="muted">u tijeku</span>'}</td>
    <td class="mine">${isNaN(r.myExT) ? '<span class="muted">otvoreno</span>' : cell2("<b>" + fmtP(r.c.avgExit) + "</b>", fmtT(r.myExT))}</td><td class="r ${cls(r.dOut)}"><b>${r.fin ? fmtPct(r.dOut) : "–"}</b></td>
    <td class="r">${r.fin ? cell2("<b class='" + cls(r.sp) + "'>" + fmtPct(r.sp) + "</b>", fmtR(r.sg.rnet)) : "–"}</td><td class="r mine2">${r.fin ? cell2("<b class='" + cls(r.mp) + "'>" + fmtPct(r.mp) + "</b>", fmtR(r.mr)) : "–"}</td>
    <td class="r ${cls(r.dPct)}">${r.fin ? cell2("<b>" + fmtPct(r.dPct) + "</b>", fmtR(r.dR)) : "–"}</td></tr>`).join("");
  const head = '<tr><th>Par</th><th>Ulaz signala</th><th class="mine">Moj ulaz</th><th class="r">Razlika ulaza</th><th>Izlaz signala</th><th class="mine">Moj izlaz</th><th class="r">Razlika izlaza</th><th class="r">Signal %<div class="muted" style="font-weight:400">R</div></th><th class="r mine">Moj %<div class="muted" style="font-weight:400">R</div></th><th class="r">Ja − signal</th></tr>';
  const avgS = n ? sum("sp") / n : NaN, avgM = n ? sum("mp") / n : NaN;
  return shell("Usporedba: signal i ja", "Svaki tvoj trejd vezan uz signal, red po red. Plavo = ti, ostalo = signal. Pozitivna razlika izlaza i rezultata znači da si prošao bolje od signala; kod ulaza je bolje niže (jeftiniji ulaz).", `
  <div class="grid g4"><div class="card stat lift"><div class="sub">Usporedivih trejdova</div><div class="v">${n}</div><div class="sub">${pend.length} još u tijeku</div></div>
    <div class="card stat lift"><div class="sub">Prosjek signala</div><div class="v ${cls(avgS)}">${n ? fmtPct(avgS) : "–"}</div><div class="sub">po trejdu</div></div>
    <div class="card stat lift"><div class="sub">Moj prosjek</div><div class="v ${cls(avgM)}">${n ? fmtPct(avgM) : "–"}</div><div class="sub">po trejdu, nakon provizije</div></div>
    <div class="card hero lift"><div class="sub">Ja − signal (zbroj)</div><div class="big">${n ? fmtR(sum("dR")) : "–"}</div><span class="chip">${n ? (sum("dR") >= 0 ? "bolji od signala" : "slabiji od signala") : "nema podataka"}</span></div></div>
  <div class="card mt"><h2>Zatvoreni na obje strane</h2><div style="overflow-x:auto"><table class="cmp">${head}${tbl(R) || '<tr><td colspan="10" class="empty">Još nema usporedivih trejdova. Pojavit će se kad zatvoriš trade vezan uz signal koji se također zatvorio.</td></tr>'}</table></div></div>
  ${pend.length ? `<div class="card mt"><h2>U tijeku</h2><div class="sub">Barem jedna strana je još otvorena.</div><div style="overflow-x:auto"><table class="cmp">${head}${tbl(pend.map(row))}</table></div></div>` : ""}`);
}

/* ---------------- Signali ---------------- */
const sigFilter = { f: "svi", q: "" }, sdFilter = { f: "pravi", q: "" };
const sigExitPrice = s => (isFinite(s.grossR) && s.entry - s.stop) ? s.entry + s.grossR * (s.entry - s.stop) : NaN;
const sigPct = s => isFinite(s.rnet) && s.entry ? s.rnet * (s.entry - s.stop) / s.entry * 100 : NaN;
function parseReasons(txt) {
  const items = [], notes = [];
  String(txt).split("\n").forEach(line => { const m = line.match(/^- (.+?) \((\d+)\/(\d+)\): (.*)$/);
    if (m) items.push({ name: m[1], v: +m[2], max: +m[3], text: m[4] }); else if (line.trim()) notes.push(line.replace(/^- /, "")); });
  const tr = items.filter(i => i.name.startsWith("Trend")), rest = items.filter(i => !i.name.startsWith("Trend"));
  const out = []; if (tr.length) out.push({ name: "Trend", v: tr.reduce((a, b) => a + b.v, 0), max: tr.reduce((a, b) => a + b.max, 0), text: tr.map(t => t.name.replace("Trend ", "").replace(/^./, c => c.toUpperCase()) + ": " + t.text).join(" · ") });
  return { items: out.concat(rest), notes };
}
function vSignali(arg) {
  const rows = realRows().sort((a, b) => b.created - a.created);
  const cnt = { svi: rows.length, pravi: rows.filter(isReal).length, otvoreni: rows.filter(s => s.status === "open" || s.status === "shadow_open").length, zatvoreni: rows.filter(isClosed).length, sjene: rows.filter(isShadow).length };
  const fl = rows.filter(s => (sigFilter.f === "svi" || (sigFilter.f === "pravi" && isReal(s)) || (sigFilter.f === "otvoreni" && isOpen(s)) || (sigFilter.f === "zatvoreni" && isClosed(s)) || (sigFilter.f === "sjene" && isShadow(s))) && (!sigFilter.q || s.pair.includes(sigFilter.q.toUpperCase())));
  const sel = rows.find(s => s.id === arg) || fl[0] || rows[0];
  const list = fl.map(s => `<div class="item k-${isShadow(s) ? "shadow" : "real"} ${sel && s.id === sel.id ? "on" : ""}" data-go="#/signali/${esc(s.id)}"><span class="coin ${isShadow(s) ? "g" : ""}"><i>${esc(dn(base(s.pair)).slice(0, 2))}</i></span>
    <div class="t"><b>${esc(dn(s.pair))} · ${isShadow(s) ? "SJENA" : "PRAVI · LONG"}</b><span>${fmtT(s.created)} · ${s.tf} · ocjena ${s.score}</span></div>${statusTag(s)}</div>`).join("") || '<div class="empty">Nema signala za taj filtar.</div>';
  let det = '<div class="card empty">Odaberite signal s popisa.</div>';
  if (sel) {
    const pr = parseReasons(sel.reasons), op = isOpen(sel);
    const lv = (lab, v, c, k) => `<div class="kv"><span>${lab}</span><span style="display:flex;gap:14px"><b class="${c || ""}">${fmtP(v)}</b>${op ? `<span class="muted" style="min-width:64px;text-align:right" data-live="${sel.pair}" data-k="${k}" data-sid="${esc(sel.id)}"></span>` : ""}</span></div>`;
    const hitTxt = sel.hit.length ? sel.hit.map(h => h + " ✓").join(" · ") : "Nijedan cilj još nije pogođen";
    det = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap"><div><h2 style="font-size:22px;font-weight:600">${esc(dn(sel.pair))} · ${isShadow(sel) ? "SJENA (probni, nije za ulazak)" : "PRAVI · LONG"}</h2>
      <div class="sub" style="margin-top:4px">Okvir ${sel.tf} · otvoren ${fmtT(sel.created)} · vrijedi do ${fmtT(sel.expires)} · strategija v1</div></div>
      <div style="text-align:right"><div class="score"><b>${sel.score}</b><span class="muted">/ 100</span></div></div></div>
      <div class="grid g2 mt" style="grid-template-columns:1fr 1fr;gap:28px"><div>
      ${lv("Ulaz", sel.entry, "", "")}${lv("Stop (" + fmtPct((sel.stop / sel.entry - 1) * 100) + ")", sel.stop, "down", "st")}${lv("T1 · 2R · 50%", sel.t1, "up", "t1")}${lv("T2 · 3R · 25%", sel.t2, "up", "")}${lv("T3 · 4R · 25%", sel.t3, "up", "")}</div>
      <div><div class="kv"><span>Status</span><span>${statusTag(sel)}</span></div>${op ? `<div class="kv"><span>Uživo</span><b data-live="${sel.pair}" data-k="r" data-sid="${esc(sel.id)}">–</b></div>` : `<div class="kv"><span>Izlaz</span><b>${REASON_TXT[sel.reason] || "–"} · ${fmtT(sel.exit)}</b></div><div class="kv"><span>Prosječna cijena izlaza</span><b>${fmtP(sigExitPrice(sel))} (${fmtPct(sigPct(sel))})</b></div>`}
      <div class="kv"><span>Pogođeno</span><b>${hitTxt}</b></div><div class="kv"><span>Rizik / pozicija</span><b>${sel.risk ? fmtN(sel.risk) + " / " + fmtN(sel.pos, 0) + " USDT" : "bez pozicije (sjena)"}</b></div></div></div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="#/graf/${esc(sel.pair)}">Otvori na grafu uživo</a></div></div>
      <div class="card mt"><h2>Na čemu se temelji signal</h2><div style="margin-top:10px">${pr.items.map(i => `<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><b>${esc(i.name)}</b><span class="muted">${i.v} / ${i.max}</span></div>
        <div class="bar"><div style="width:${i.max ? i.v / i.max * 100 : 0}%;background:${i.v / i.max >= .66 ? "var(--up)" : i.v / i.max >= .33 ? "var(--gray)" : "var(--down)"}"></div></div><div class="note">${esc(i.text)}</div></div>`).join("")}
        ${pr.notes.length ? `<div class="kv" style="display:block;margin-top:6px">${pr.notes.map(n => `<div class="note">${esc(n)}</div>`).join("")}</div>` : ""}</div>
        <p class="note"><b>Poništenje:</b> zatvaranje 1h svijeće ispod stopa (${fmtP(sel.stop)}) ili istek signala.</p></div>`;
  }
  return shell("Signali i analiza", "Odaberite signal da vidite cijelu analizu i razloge.", `<div class="split"><div>
    <div class="legend"><span class="tag real">Pravi signal</span><span class="tag shadow">Sjena (probni)</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px" id="sfilter">${[["svi", "Svi"], ["pravi", "Pravi"], ["sjene", "Sjene"], ["otvoreni", "Otvoreni"], ["zatvoreni", "Zatvoreni"]].map(([k, t]) => `<button class="chip-btn ${sigFilter.f === k ? "on" : ""}" data-f="${k}">${t} (${cnt[k]})</button>`).join("")}</div>
    <input class="txt" id="sq" placeholder="Traži par, npr. DODO" value="${esc(sigFilter.q)}" style="margin-bottom:10px"><div class="list">${list}</div></div><div>${det}</div></div>`);
}

/* ---------------- Arhiva parova ---------------- */
const arch = { f: "svi", q: "" };
function vArhiva() {
  const by = {}; realRows().filter(s => s.kind === "real").forEach(s => { (by[s.pair] = by[s.pair] || []).push(s); });
  let list = Object.entries(by).map(([pair, ss]) => { ss.sort((a, b) => b.created - a.created); const cl = ss.filter(isClosed), tot = cl.reduce((a, s) => a + (s.rnet || 0), 0);
    return { pair, ss, n: ss.length, open: ss.filter(isOpen).length, tot, last: ss[0], real: ss.filter(s => s.kind === "real").length }; });
  list = list.filter(p => (arch.f === "svi" || (arch.f === "otvoreni" && p.open) || (arch.f === "dobitni" && p.tot > 0) || (arch.f === "gubitni" && p.tot < 0)) && (!arch.q || p.pair.includes(arch.q.toUpperCase())));
  list.sort((a, b) => b.last.created - a.last.created);
  return shell("Arhiva parova", "Svi parovi za koje je bilo pravih signala. Klik na par otvara graf sa svim njegovim signalima.", `<div class="card">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center" id="afilter">${["svi", "otvoreni", "dobitni", "gubitni"].map(k => `<button class="chip-btn ${arch.f === k ? "on" : ""}" data-f="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}
    <input class="txt sm" id="aq" placeholder="Traži par" value="${esc(arch.q)}" style="margin-left:auto"></div>
    <table><tr><th>Par</th><th class="r">Cijena uživo</th><th class="r">Signala</th><th class="r">Otvorenih</th><th>Zadnji signal</th><th class="r">Zbroj R</th><th>Zadnji ishod</th></tr>
    ${list.map(p => `<tr class="click" data-go="#/graf/${esc(p.pair)}"><td>${coin(p.pair)}</td><td class="r"><span data-live="${p.pair}" data-k="price">${S.prices[p.pair] ? fmtP(S.prices[p.pair]) : "–"}</span></td><td class="r">${p.n}</td><td class="r">${p.open || "–"}</td><td class="muted">${fmtT(p.last.created)}</td>
    <td class="r ${cls(p.tot)}"><b>${p.ss.some(isClosed) ? fmtR(p.tot) : "–"}</b></td><td>${statusTag(p.last)}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">Nema parova za taj filtar.</td></tr>'}</table></div>`);
}

/* ---------------- Statistika ---------------- */
function vStatSig() {
  const rows = realRows().filter(s => inRange(isClosed(s) ? s.exit : s.created)), real = rows.filter(s => s.kind === "real" && s.status === "closed"), sh = rows.filter(s => s.status === "shadow_closed");
  const card = (t, rs, dd) => { const s = summarize(rs, "rnet"); if (!s) return `<div class="card"><h2>${t}</h2><div class="empty">Nema zatvorenih signala.</div></div>`;
    return `<div class="card"><h2>${t}</h2><div style="margin-top:8px"><div class="kv"><span>Zatvorenih</span><b>${s.n}</b></div><div class="kv"><span>Stopa pogodaka</span><b>${s.win.toFixed(0)}%</b></div><div class="kv"><span>Prosječni R</span><b class="${cls(s.avg)}">${fmtR(s.avg)}</b></div>
      <div class="kv"><span>Zbroj R</span><b class="${cls(s.sum)}">${fmtR(s.sum)}</b></div><div class="kv"><span>Profit factor</span><b>${isFinite(s.pf) ? fmtN(s.pf) : "∞"}</b></div>${dd ? `<div class="kv"><span>Maksimalni pad računa</span><b>${fmtN(maxDD(rs, "pnl", START_EQUITY), 1)}%</b></div>` : ""}</div></div>`; };
  const bucket = (lo, hi) => { const f = rs => rs.filter(s => s.score >= lo && s.score < hi), a = summarize(f(real), "rnet"), b = summarize(f(sh), "rnet");
    const c = s => s ? `${s.n} · ${s.win.toFixed(0)}% · <b class="${cls(s.avg)}">${fmtR(s.avg)}</b>` : "<span class='muted'>–</span>";
    return `<tr><td>${lo}–${Math.min(hi - 1, 100)}</td><td>${c(a)}</td><td>${c(b)}</td></tr>`; };
  const byR = k => { const o = {}; rows.filter(isClosed).forEach(s => { const key = s[k]; (o[key] = o[key] || []).push(s); }); return o; };
  const tfr = byR("tf"), rsn = byR("reason");
  return shell("Statistika signala", "Što bi se dogodilo da se točno slušaju stop i ciljevi. Pravi signali i sjene, nakon troškova. Strategija se ne mijenja prije 4 tjedna ili 100 zatvorenih signala.", dateBar() + `
  <div class="grid g3">${card("Pravi signali", real, true)}${card("Sjene (bez obavijesti)", sh, false)}
  <div class="card"><h2>Napredak do pregleda</h2><div style="margin-top:12px"><div class="kv"><span>Zatvorenih pravih</span><b>${real.length} / 100</b></div><div class="bar" style="margin:8px 0 14px"><div style="width:${Math.min(100, real.length)}%;background:var(--red)"></div></div>
  <div class="kv"><span>Ukupno signala</span><b>${rows.length}</b></div><div class="kv"><span>Otvorenih</span><b>${rows.filter(isOpen).length}</b></div></div></div></div>
  <div class="grid g2 mt" style="grid-template-columns:1fr 1fr"><div class="card"><h2>Po ocjeni signala</h2><div class="sub">Broj · pogodaka · prosječni R. Pomaže pri odluci o pragu.</div>
    <table><tr><th>Ocjena</th><th>Pravi</th><th>Sjene</th></tr>${[[55, 60], [60, 65], [65, 70], [70, 80], [80, 101]].map(([a, b]) => bucket(a, b)).join("")}</table></div>
  <div class="card"><h2>Po razlogu izlaza i okviru</h2><div class="sub">Svi zatvoreni, pravi i sjene</div><table><tr><th>Razlog</th><th class="r">Broj</th><th class="r">Prosj. R</th></tr>
    ${Object.entries(rsn).map(([k, v]) => { const s = summarize(v, "rnet"); return `<tr><td>${REASON_TXT[k] || k}</td><td class="r">${s.n}</td><td class="r ${cls(s.avg)}">${fmtR(s.avg)}</td></tr>`; }).join("")}</table>
    <table style="margin-top:10px"><tr><th>Okvir</th><th class="r">Broj</th><th class="r">Prosj. R</th></tr>${Object.entries(tfr).map(([k, v]) => { const s = summarize(v, "rnet"); return `<tr><td>${k}</td><td class="r">${s.n}</td><td class="r ${cls(s.avg)}">${fmtR(s.avg)}</td></tr>`; }).join("")}</table></div></div>`);
}

function vStatMoja() {
  const all = J().filter(t => inRange(jOpen(t) ? t.t : lastExit(t))), cl = all.filter(t => !jOpen(t)), op = all.filter(jOpen);
  const cs = cl.map(t => { const c = jcalc(t); const sg = S.rows.find(s => s.id === t.sig); return { t, c, sg }; }).sort((a, b) => a.t.exits[a.t.exits.length - 1].t - b.t.exits[b.t.exits.length - 1].t);
  const n = cs.length, wins = cs.filter(x => x.c.realized > 0), loss = cs.filter(x => x.c.realized <= 0);
  const sum = cs.reduce((a, x) => a + x.c.realized, 0), gw = wins.reduce((a, x) => a + x.c.realized, 0), gl = -loss.reduce((a, x) => a + x.c.realized, 0);
  const avgPct = n ? cs.reduce((a, x) => a + x.c.pct, 0) / n : NaN, inv = cs.reduce((a, x) => a + x.t.usdt, 0);
  const best = n ? cs.reduce((a, x) => x.c.realized > a.c.realized ? x : a) : null, worst = n ? cs.reduce((a, x) => x.c.realized < a.c.realized ? x : a) : null;
  const kv = (l, v, c) => `<div class="kv"><span>${l}</span><b class="${c || ""}">${v}</b></div>`;
  const myR = x => { const sg = x.sg; if (!sg || !(sg.entry - sg.stop)) return NaN; return (x.c.avgExit - x.t.p) / (sg.entry - sg.stop); };
  const cmp = cs.filter(x => x.sg && isClosed(x.sg));
  const cmpRows = cmp.map(x => { const mr = myR(x), d = mr - x.sg.rnet, sp = x.sg.exit; return `<tr><td>${coin(x.t.pair)}</td><td>${kindTag(x.sg)}</td><td class="muted">${fmtT(x.t.exits[x.t.exits.length - 1].t)}</td><td class="r">${fmtP(x.c.avgExit)}</td><td class="r ${cls(mr)}"><b>${isNaN(mr) ? "–" : fmtR(mr)}</b></td><td class="muted">${REASON_TXT[x.sg.reason] || "–"} · ${fmtT(sp)}</td><td class="r ${cls(x.sg.rnet)}"><b>${fmtR(x.sg.rnet)}</b></td><td class="r ${cls(d)}"><b>${isNaN(d) ? "–" : fmtR(d)}</b></td></tr>`; }).join("");
  const dsum = cmp.reduce((a, x) => a + (myR(x) - x.sg.rnet || 0), 0);
  const list = [...cs].reverse().map(x => `<tr><td>${coin(x.t.pair)}</td><td class="muted">${fmtT(x.t.t)}</td><td class="r">${fmtP(x.t.p)}</td><td class="muted">${fmtT(x.t.exits[x.t.exits.length - 1].t)}</td><td class="r">${fmtP(x.c.avgExit)}</td><td class="r">${fmtN(x.t.usdt)}</td><td class="r ${cls(x.c.realized)}"><b>${jm(x.c.realized)}</b></td><td class="r ${cls(x.c.pct)}">${fmtPct(x.c.pct)}</td></tr>`).join("");
  return shell("Moja statistika", "Računa se samo iz tvog dnevnika, od trenutka kad si ti označio izlaz, po tvojoj cijeni i nakon provizije.", dateBar() + `
  <div class="grid g3"><div class="card"><h2>Moji trejdovi</h2><div style="margin-top:8px">${kv("Zatvorenih", n)}${kv("Još otvorenih", op.length)}${kv("Stopa pogodaka", n ? Math.round(wins.length / n * 100) + "%" : "–")}${kv("Profit factor", n ? (gl > 0 ? fmtN(gw / gl) : gw > 0 ? "∞" : "–") : "–")}</div></div>
    <div class="card"><h2>Zarada</h2><div style="margin-top:8px">${kv("Ukupno realizirano", jm(sum) + " USDT", cls(sum))}${kv("Prosjek po trejdu", n ? jm(sum / n) + " USDT" : "–", cls(sum))}${kv("Prosjek po trejdu (%)", n ? fmtPct(avgPct) : "–", cls(avgPct))}${kv("Povrat na uloženo", inv ? fmtPct(sum / inv * 100) : "–", cls(sum))}</div></div>
    <div class="card"><h2>Najbolji i najgori</h2><div style="margin-top:8px">${kv("Najbolji", best ? best.t.pair + " " + jm(best.c.realized) : "–", best ? cls(best.c.realized) : "")}${kv("Najgori", worst ? worst.t.pair + " " + jm(worst.c.realized) : "–", worst ? cls(worst.c.realized) : "")}${kv("Pravi signali", cs.filter(x => x.sg && isReal(x.sg)).length)}${kv("Ručni ulazi", cs.filter(x => !x.sg).length)}</div></div></div>
  <div class="card mt"><h2>Zatvoreni trejdovi</h2><table><tr><th>Par</th><th>Ulaz</th><th class="r">Cijena ulaza</th><th>Izlaz</th><th class="r">Cijena izlaza</th><th class="r">USDT</th><th class="r">Zarada</th><th class="r">%</th></tr>${list || '<tr><td colspan="8" class="empty">Još nema zatvorenih trejdova u dnevniku.</td></tr>'}</table></div>`);
}

/* ---------------- Postavke ---------------- */
function vPostavke() {
  return shell("Postavke", "Veza na podatke i osnovne opcije.", `<div class="grid g2" style="grid-template-columns:1fr 1fr"><div class="card"><h2>Veza na GitHub</h2>
    <label class="f">Repozitorij</label><input class="txt" id="srepo" value="${esc(cfg.repo)}"><label class="f">Grana</label><input class="txt" id="sbranch" value="${esc(cfg.branch)}">
    <label class="f">Token (samo čitanje)</label><input class="txt" id="stoken" type="password" placeholder="${cfg.token ? "••••••••  (spremljen na ovom računalu)" : "github_pat_…"}" autocomplete="off">
    <label class="f">Token za spremanje dnevnika (čitanje i pisanje, nije obavezno)</label><input class="txt" id="swtoken" type="password" placeholder="${cfg.wtoken ? "••••••••  (spremljen)" : "github_pat_…"}" autocomplete="off">
    <label class="f">Osvježavanje podataka (sekunde)</label><input class="txt" id="sref" type="number" min="20" value="${cfg.refresh}">
    <label class="f" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="sdemo" ${cfg.demo ? "checked" : ""}> Koristi primjer podataka (za isprobavanje)</label>
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button class="btn primary" id="ssave">Spremi i testiraj</button><button class="btn" id="sclear">Obriši token</button><button class="btn" id="swclear">Obriši token za dnevnik</button></div></div>
    <div class="card help"><h2>Kako napraviti token</h2><p class="note" style="margin-top:0"><b>Drugi token (za spremanje dnevnika):</b> isti postupak, ali pod Permissions postavi <b>Contents: Read and write</b>, i nazovi ga npr. "dnevnik". Dnevnik se tada sprema u tvoj privatni repozitorij u datoteku data/moji_trejdovi.json, pa ga ne možeš izgubiti.</p><ol><li>Na GitHubu otvorite <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li><li>Pod <b>Repository access</b> odaberite <b>Only select repositories</b> i samo <b>crypto-signals</b>.</li><li>Pod <b>Permissions → Repository permissions</b> postavite <b>Contents: Read-only</b>.</li><li>Kopirajte token i zalijepite ga lijevo.</li></ol>
    Token ostaje samo u pregledniku na ovom računalu i šalje se jedino GitHubu, nikome drugome. Ima samo pravo čitanja, pa ništa ne može promijeniti.<p style="margin-top:10px">Cijene i grafovi dolaze izravno s Binancea, bez tokena.</p></div>
    <div class="card"><h2>Obavijesti</h2><div class="sub">Kad stigne novi signal ili se zatvori otvoreni, aplikacija pokaže poruku (i u naslovu prozora). Za obavijesti i izvan prozora uključi ih ovdje.</div><div style="margin-top:12px"><button class="btn primary" id="snotif">Uključi obavijesti na računalu</button> <span class="muted" id="snstate" style="margin-left:8px">${"Notification" in window ? "Stanje: " + ({ granted: "uključeno", denied: "blokirano", default: "nije uključeno" }[Notification.permission]) : "nije podržano"}</span></div></div></div>`);
}

/* ---------------- Graf uzivo ---------------- */
const chartState = Object.assign({ pair: "", tf: "1h", show: "all", ema: true, vol: true, rsi: true, macd: true }, lsGet("chartState", {}));
const INTERVAL = { "15m": "15m", "1h": "1h", "4h": "4h", "1D": "1d" };
const DEFAULT_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
function userLines(pair) { return lsGet("lines:" + pair, []); }
function allLines() { const pr = chartState.pair; return userLines(pr).concat(J().filter(t => t.pair === pr).flatMap(t => [{ id: "je" + t.id, price: t.p, label: "Moj ulaz" }].concat(t.exits.map((x, i) => ({ id: "jx" + t.id + i, price: x.p, label: "Moj izlaz" }))))); }
function vGraf(arg) {
  if (arg) chartState.pair = arg.toUpperCase(); if (!chartState.pair) { const o = S.rows.find(s => s.status === "open"); chartState.pair = o ? o.pair : "BTCUSDT"; }
  lsSet("chartState", chartState); syncLive();
  const pairs = [...new Set([...S.rows.map(s => s.pair), ...DEFAULT_PAIRS])].sort();
  const cb = (k, t) => `<label class="chip-btn ${chartState[k] ? "on" : ""}" style="display:inline-flex;align-items:center;cursor:pointer"><input type="checkbox" data-ind="${k}" ${chartState[k] ? "checked" : ""} style="display:none">${t}</label>`;
  return shell("Graf uživo", "Svijeće i indikatori u stvarnom vremenu s Binancea. Signali su ucrtani automatski.", `
  <div class="chartbar"><input class="txt sm" id="gpair" list="pairs" value="${esc(dn(chartState.pair))}" aria-label="Par"><datalist id="pairs">${pairs.map(p => `<option value="${dn(p)}">`).join("")}</datalist>
    <div class="seg" id="gtf">${Object.keys(INTERVAL).map(k => `<button data-tf="${k}" class="${chartState.tf === k ? "on" : ""}">${k}</button>`).join("")}</div>
    ${cb("ema", "EMA")}${cb("vol", "Volumen")}${cb("rsi", "RSI")}${cb("macd", "MACD")}
    <select class="txt sm" id="gshow" style="width:auto"><option value="all">Svi signali</option><option value="real">Samo pravi</option><option value="open">Samo otvoreni</option></select>
    <button class="chip-btn" id="gadd">+ Moja linija</button><button class="chip-btn" id="greset">Vrati prikaz</button></div>
  <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:10px;flex-wrap:wrap"><span class="price-big" id="gprice">–</span><span id="gpct" style="font-weight:600"></span><div class="ohlc" id="gohlc"></div></div>
  <div class="cl"><div class="chartwrap" id="gwrap"></div><div class="cside"><div class="card"><h2>Signali na ovom paru</h2><div id="gsigs" style="margin-top:8px"></div></div>
    <div class="card"><h2>Moje linije</h2><div class="sub">Klik na „+ Moja linija“, pa klik na graf. Ili upišite cijenu.</div><div style="display:flex;gap:8px;margin-top:10px"><input class="txt" id="gprice-in" placeholder="Cijena" inputmode="decimal"><button class="btn" id="gprice-add">Dodaj</button></div><div id="glines" style="margin-top:8px"></div></div></div></div>`);
}
function chartSigs() {
  const pair = chartState.pair; let ss = S.rows.filter(s => s.pair === pair && s.status !== "skipped_capital");
  if (chartState.show === "real") ss = ss.filter(s => s.kind === "real"); if (chartState.show === "open") ss = ss.filter(isOpen);
  return ss.map(s => { const o = isOpen(s); let xp = null, lab = ""; if (!o) { xp = s.reason === "T3" ? s.t3 : s.reason === "stop" ? s.stop : s.reason === "stop_na_ulazu" ? s.entry : null;
      if (xp == null && chart) { const i = chart.idxOfTime(s.exit); const k = chart.c[Math.max(0, Math.min(chart.c.length - 1, Math.round(i)))]; xp = k ? k.c : s.entry; }
      lab = (REASON_TXT[s.reason] || "") + " " + fmtR(s.rnet); }
    return { id: s.id, open: o, start: s.created, end: o ? null : s.exit, entry: s.entry, stop: s.stop, t1: s.t1, t2: s.t2, t3: s.t3, rnet: s.rnet, exitPrice: xp, exitLabel: lab, kind: s.kind }; });
}
function paintChartSide() {
  const sg = $("#gsigs"); if (!sg) return; const ss = S.rows.filter(s => s.pair === chartState.pair && s.status !== "skipped_capital").sort((a, b) => b.created - a.created);
  sg.innerHTML = ss.length ? ss.map(s => `<div class="kv" style="cursor:pointer;align-items:center" data-go="#/signali/${esc(s.id)}"><span>${kindTag(s)} ${fmtT(s.created)} · ${s.score}</span>${statusTag(s)}</div>`).join("") : '<div class="note">Nema signala za ovaj par. Možete ga ipak pratiti i crtati svoje linije.</div>';
  const ls = userLines(chartState.pair); $("#glines").innerHTML = ls.map(l => `<div class="kv" style="align-items:center"><span style="color:#3B6FD4">● ${esc(l.label || "Moja linija")}</span><span style="display:flex;align-items:center;gap:6px"><b>${fmtP(l.price)}</b><button class="x" data-del="${l.id}" aria-label="Obriši liniju">×</button></span></div>`).join("");
}
function paintChartHead(h) {
  const p = S.prices[chartState.pair]; const pe = $("#gprice"); if (!pe) return; if (p != null) pe.textContent = fmtP(p);
  const o = S.open24[chartState.pair]; const pc = $("#gpct"); if (pc && o && p != null) { const v = (p / o - 1) * 100; pc.textContent = fmtPct(v); pc.className = cls(v); pe.className = "price-big " + cls(v); }
  if (h !== undefined) { const el = $("#gohlc"); if (!el) return; if (h) { const k = h.k; el.innerHTML = `<span>${fmtT(k.t)}</span><span>O ${fmtP(k.o)}</span><span>H ${fmtP(k.h)}</span><span>L ${fmtP(k.l)}</span><span>Z ${fmtP(k.c)}</span><span class="${cls(k.c - k.o)}">${fmtPct((k.c / k.o - 1) * 100)}</span>`; } else el.innerHTML = ""; }
}
async function loadKlines() {
  const pair = chartState.pair, tf = chartState.tf;
  try {
    const r = await fetch(`${BINANCE}/api/v3/klines?symbol=${pair}&interval=${INTERVAL[tf]}&limit=500`); if (!r.ok) throw new Error("Par " + pair + " nije pronađen na Binanceu.");
    const d = (await r.json()).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })); if (!chart || pair !== chartState.pair || tf !== chartState.tf) return;
    chart.setData(d, tf); chart.setSignals(chartSigs()); if (S.prices[pair] == null && d.length) { S.prices[pair] = d[d.length - 1].c; } chart.setLive(S.prices[pair]); paintChartHead();
    if (kws) { kws.onclose = null; try { kws.close(); } catch (e) {} }
    kws = new WebSocket(`${WSBASE}/ws/${pair.toLowerCase()}@kline_${INTERVAL[tf]}`);
    kws.onmessage = ev => { try { const k = JSON.parse(ev.data).k; if (!k || !chart) return; chart.update({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }); S.prices[pair] = +k.c; S.tick = Date.now(); paintChartHead(); } catch (e) {} };
    kws.onclose = () => { setTimeout(() => { if (chart && pair === chartState.pair && tf === chartState.tf) loadKlines(); }, 3000); };
  } catch (e) { toast(String(e.message || e)); }
}

/* ---------------- povezivanje dogadjaja ---------------- */
function bind(arg) {
  const main = $("#main");
  main.querySelectorAll("[data-go]").forEach(e => e.addEventListener("click", () => { location.hash = e.dataset.go; }));
  if (currentView === "pregled" || currentView === "moj") main.querySelectorAll("#eqseg button").forEach(b => b.addEventListener("click", () => { eqRange = b.dataset.r; lsSet("eqRange", eqRange); render(); }));
  if (currentView === "signali") {
    main.querySelectorAll("#sfilter button").forEach(b => b.addEventListener("click", () => { sigFilter.f = b.dataset.f; render(); }));
    const q = $("#sq"); q.addEventListener("input", () => { sigFilter.q = q.value; const pos = q.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(pos, pos); });
  }
  if (currentView === "arhiva") {
    main.querySelectorAll("#afilter button").forEach(b => b.addEventListener("click", () => { arch.f = b.dataset.f; render(); }));
    const q = $("#aq"); q.addEventListener("input", () => { arch.q = q.value; const pos = q.selectionStart; render(); const n = $("#aq"); n.focus(); n.setSelectionRange(pos, pos); });
  }
  if (currentView === "postavke") {
    $("#ssave").addEventListener("click", async () => {
      const t = $("#stoken").value.trim(); cfg = Object.assign(cfg, { repo: $("#srepo").value.trim(), branch: $("#sbranch").value.trim() || "main", refresh: +$("#sref").value || 60, demo: $("#sdemo").checked }); if (t) cfg.token = t; const wt = $("#swtoken").value.trim(); if (wt) cfg.wtoken = wt;
      lsSet("cfg", cfg); S.source = "x"; await refreshData(); toast(S.err ? S.err : cfg.demo || !cfg.token ? "Spremljeno. Prikazuju se primjer podataka." : "Povezano. Učitano signala: " + S.rows.length);
    });
    $("#snotif").addEventListener("click", async () => { try { const r = await Notification.requestPermission(); $("#snstate").textContent = "Stanje: " + ({ granted: "uključeno", denied: "blokirano", default: "nije uključeno" }[r]); if (r === "granted") new Notification("Kripto signali", { body: "Obavijesti su uključene.", icon: "favicon-256.png" }); } catch (e) { toast("Ovaj prozor ne podržava obavijesti."); } });
    $("#swclear").addEventListener("click", () => { cfg.wtoken = ""; lsSet("cfg", cfg); render(); toast("Token za dnevnik je obrisan."); });
    $("#sclear").addEventListener("click", () => { cfg.token = ""; lsSet("cfg", cfg); S.source = "x"; refreshData(); toast("Token je obrisan s ovog računala."); });
  }
  if (currentView === "moj") { const b = $("#setstart"); if (b) b.addEventListener("click", () => { const v = prompt("Koliko je USDT na tvom Binance računu za ove trejdove (početno stanje)?", lsGet("mojStart", "") || ""); if (v === null) return; const n = parseFloat(String(v).replace(",", ".")); lsSet("mojStart", isFinite(n) && n > 0 ? n : 0); lsSet("journalUpd", Date.now()); jPushSoon(); render(); }); }
  if (currentView === "sdnevnik") { main.querySelectorAll("#sfilter button").forEach(b => b.addEventListener("click", () => { sdFilter.f = b.dataset.f; render(); })); const q = $("#sq"); if (q) q.addEventListener("input", () => { sdFilter.q = q.value; const pos = q.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(pos, pos); }); }
  const dfb = $("#dfbar"); if (dfb) dfb.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { dateF = b.dataset.df; lsSet("dateF", dateF); render(); }));
  if (currentView === "dnevnik") bindDnevnik(arg);
  if (currentView === "graf") bindChart();
}
function bindChart() {
  const wrap = $("#gwrap"); chart = new PriceChart(wrap, { ema: chartState.ema, vol: chartState.vol, rsi: chartState.rsi, macd: chartState.macd }); chart.setTheme(document.documentElement.dataset.theme);
  chart.onHover = h => paintChartHead(h); $("#gshow").value = chartState.show;
  chart.setLines(allLines()); paintChartSide(); loadKlines();
  const addLine = price => { const ls = userLines(chartState.pair); ls.push({ id: String(Date.now()), price, label: "Moja linija" }); lsSet("lines:" + chartState.pair, ls); chart.setLines(allLines()); paintChartSide(); };
  chart.onAdd = p => { addLine(p); chart.setAddMode(false); $("#gadd").classList.remove("on"); };
  $("#gpair").addEventListener("change", e => { const v = realSym(e.target.value.trim().toUpperCase()); if (!v) return; location.hash = "#/graf/" + (v.endsWith("USDT") ? v : v + "USDT"); });
  $("#gtf").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { chartState.tf = b.dataset.tf; lsSet("chartState", chartState); $("#gtf").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); chart.setData([], chartState.tf); loadKlines(); }));
  document.querySelectorAll("[data-ind]").forEach(i => i.addEventListener("change", () => { chartState[i.dataset.ind] = i.checked; i.parentElement.classList.toggle("on", i.checked); lsSet("chartState", chartState); chart.setOpts({ [i.dataset.ind]: i.checked }); }));
  $("#gshow").addEventListener("change", e => { chartState.show = e.target.value; lsSet("chartState", chartState); chart.setSignals(chartSigs()); });
  $("#gadd").addEventListener("click", e => { const on = !e.target.classList.contains("on"); e.target.classList.toggle("on", on); chart.setAddMode(on); if (on) toast("Kliknite na graf gdje želite liniju."); });
  $("#greset").addEventListener("click", () => chart.reset());
  $("#gprice-add").addEventListener("click", () => { const v = parseFloat($("#gprice-in").value.replace(",", ".")); if (!isFinite(v) || v <= 0) { toast("Upišite ispravnu cijenu."); return; } addLine(v); $("#gprice-in").value = ""; });
  $("#glines").addEventListener("click", e => { const d = e.target.dataset.del; if (!d) return; const ls = userLines(chartState.pair).filter(l => l.id !== d); lsSet("lines:" + chartState.pair, ls); chart.setLines(allLines()); paintChartSide(); });
  paintChartSide();
}
/* ---------------- Moj dnevnik trejdova ---------------- */
const DF = [["sve", "Sve"], ["danas", "Danas"], ["tjedan", "7 dana"], ["mjesec", "30 dana"]];
let dateF = lsGet("dateF", "sve");
const inRange = ms => { if (dateF === "sve" || !isFinite(ms)) return true; const d = new Date(), t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return ms >= (dateF === "danas" ? t0 : dateF === "tjedan" ? Date.now() - 7 * 864e5 : Date.now() - 30 * 864e5); };
const dateBar = () => `<div class="seg" id="dfbar" style="margin:0 0 16px">${DF.map(([k, t]) => `<button data-df="${k}" class="${dateF === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
const lastExit = t => t.exits.length ? t.exits[t.exits.length - 1].t : t.t;
const J = () => lsGet("journal", []);
const saveJ = a => { lsSet("journal", a); lsSet("journalUpd", Date.now()); jPushSoon(); };
/* ---- sigurnosna kopija dnevnika na GitHub (data/moji_trejdovi.json) ---- */
const JPATH = "data/moji_trejdovi.json";
const jUrl = () => `https://api.github.com/repos/${cfg.repo}/contents/${JPATH}`;
const jHeaders = (tok, raw) => ({ Authorization: "Bearer " + tok, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
let jTimer = null, jBusy = false, jWarned = false;
function jPushSoon() { if (!cfg.wtoken) return; clearTimeout(jTimer); jTimer = setTimeout(jPush, 1500); }
async function jPush() {
  if (!cfg.wtoken || jBusy) return; jBusy = true;
  try {
    let sha; const g = await fetch(jUrl() + "?ref=" + encodeURIComponent(cfg.branch || "main"), { headers: jHeaders(cfg.wtoken), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error("GitHub " + g.status);
    const body = JSON.stringify({ updated: lsGet("journalUpd", 0), start: lsGet("mojStart", 0), trades: J() });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
    const p = await fetch(jUrl(), { method: "PUT", headers: jHeaders(cfg.wtoken), body: JSON.stringify({ message: "Dnevnik: spremanje", content: b64, sha, branch: cfg.branch || "main" }) });
    if (!p.ok) throw new Error("GitHub " + p.status);
    S.jsync = Date.now(); S.jerr = ""; jWarned = false;
  } catch (e) { S.jerr = String(e.message || e); if (!jWarned) { jWarned = true; toast("Spremanje dnevnika na GitHub nije uspjelo (" + S.jerr + "). Provjeri token u Postavkama."); } }
  jBusy = false; topPills();
}
async function jPull() {
  const tok = cfg.wtoken || cfg.token; if (!tok || cfg.demo || jBusy) return;
  try {
    const r = await fetch(jUrl() + "?ref=" + encodeURIComponent(cfg.branch || "main"), { headers: jHeaders(tok, true), cache: "no-store" });
    if (r.status === 404) { if (cfg.wtoken && J().length) jPush(); return; } if (!r.ok) return;
    const d = JSON.parse(await r.text()), lu = lsGet("journalUpd", 0);
    if (d.updated > lu) { lsSet("journal", d.trades || []); lsSet("mojStart", d.start || 0); lsSet("journalUpd", d.updated); S.jsync = Date.now(); if (["moj", "dnevnik", "mojastat", "usporedba"].includes(currentView) && !jExit && !jEdit) render(); }
    else if (d.updated < lu && cfg.wtoken) jPush();
    else S.jsync = Date.now();
  } catch (e) {}
}
const jm = v => (isFinite(v) ? (v > 0 ? "+" : "") + fmtN(v, 2) : "–");
const jqty = t => t.usdt / t.p;
const jsold = t => t.exits.reduce((a, x) => a + x.q, 0);
const jOpen = t => jqty(t) - jsold(t) > jqty(t) * 1e-6;
function jcalc(t, live) {
  const q = jqty(t), sold = jsold(t), rem = Math.max(0, q - sold), fee = (t.fee || 0) / 100, feeIn = t.usdt * fee;
  const realized = t.exits.reduce((a, x) => a + x.q * (x.p - t.p) - x.q * x.p * fee, 0) - feeIn * (sold / q);
  const unreal = rem > q * 1e-6 && isFinite(live) ? rem * (live - t.p) - feeIn * (rem / q) - rem * live * fee : 0;
  const proceeds = t.exits.reduce((a, x) => a + x.q * x.p, 0);
  const avgExit = sold > 0 ? proceeds / sold : NaN;
  return { q, sold, rem, realized, unreal, total: realized + unreal, pct: (realized + unreal) / t.usdt * 100, avgExit, remPct: rem / q * 100 };
}
function jTotals(arr) {
  const a = arr || J(); let realized = 0, unreal = 0, inv = 0, n = 0, win = 0, cl = 0;
  a.forEach(t => { const c = jcalc(t, S.prices[t.pair]); realized += c.realized; unreal += c.unreal; n++; if (jOpen(t)) inv += c.rem * t.p; else { cl++; if (c.realized > 0) win++; } });
  return { realized, unreal, total: realized + unreal, inv, n, cl, win };
}
const nowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
let jExit = "", jEdit = "";
function vDnevnik(arg) {
  const a = J().filter(t => inRange(t.t)).sort((x, y) => y.t - x.t), tt = jTotals(a);
  const sigId = arg && S.rows.find(s => s.id === arg) ? arg : "";
  const pre = sigId ? S.rows.find(s => s.id === sigId) : null;
  const sigs = realRows().filter(s => s.kind === "real" && isOpen(s)).sort((x, y) => y.created - x.created);
  const pairs = [...new Set([...S.rows.map(s => s.pair), ...DEFAULT_PAIRS])].sort();
  const ex = jExit ? a.find(t => t.id === jExit) : null;
  const ed = jEdit ? J().find(t => t.id === jEdit) : null;
  const toLocal = ms => { const d = new Date(ms - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
  const edForm = ed ? `<div class="modal" id="emodal"><div class="card mbox"><h2>Uredi trejd · ${esc(dn(ed.pair))}</h2><div class="sub">Ispravi krivo upisane podatke. Izmjene se odmah preračunavaju.</div>
    <div class="jgrid"><div><label class="f">Par</label><input class="txt" id="ep" value="${esc(dn(ed.pair))}"></div><div><label class="f">Cijena ulaza</label><input class="txt" id="ec" inputmode="decimal" value="${fmtRaw(ed.p)}"></div><div><label class="f">Uloženo (USDT)</label><input class="txt" id="eu" inputmode="decimal" value="${fmtRaw(ed.usdt)}"></div>
    <div><label class="f">Vrijeme ulaza</label><input class="txt" id="et" type="datetime-local" value="${toLocal(ed.t)}"></div><div><label class="f">Provizija po strani (%)</label><input class="txt" id="ef" inputmode="decimal" value="${ed.fee}"></div></div>
    ${ed.exits.length ? `<h2 style="margin-top:14px;font-size:15px">Izlazi</h2>${ed.exits.map((x, i) => `<div class="jgrid" style="align-items:end"><div><label class="f">Cijena izlaza ${i + 1}</label><input class="txt" data-xp="${i}" inputmode="decimal" value="${fmtRaw(x.p)}"></div><div><label class="f">Vrijeme izlaza</label><input class="txt" data-xt="${i}" type="datetime-local" value="${toLocal(x.t)}"></div><div><button class="btn sm" data-xdel="${i}">Obriši ovaj izlaz</button></div></div>`).join("")}` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" id="esave">Spremi izmjene</button><button class="btn" id="ecancel">Odustani</button></div></div></div>` : "";
  const exForm = ex ? `<div class="modal" id="xmodal"><div class="card mbox"><h2>Izlaz iz trejda · ${esc(ex.pair)}</h2><div class="sub">Preostalo ${fmtN(jcalc(ex, S.prices[ex.pair]).remPct, 0)}% pozicije. Za djelomičan izlaz upišite manji udio.</div>
    <div class="jgrid"><div><label class="f">Cijena izlaza (USDT)</label><input class="txt" id="xp" inputmode="decimal" value="${S.prices[ex.pair] ? fmtRaw(S.prices[ex.pair]) : ""}"></div>
    <div><label class="f">Udio preostale pozicije (%)</label><input class="txt" id="xs" inputmode="decimal" value="100"></div>
    <div><label class="f">Vrijeme izlaza</label><input class="txt" id="xt" type="datetime-local" value="${nowLocal()}"></div></div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" id="xsave">Spremi izlaz</button><button class="btn" id="xcancel">Odustani</button></div></div></div>` : "";
  const rowsH = a.map(t => { const c = jcalc(t, S.prices[t.pair]), op = jOpen(t), sg = S.rows.find(s => s.id === t.sig);
    return `<tr><td>${coin(t.pair)}</td><td>${sg ? kindTag(sg) : '<span class="muted">ručno</span>'}</td><td class="muted">${fmtT(t.t)}</td><td class="r">${fmtP(t.p)}</td><td class="r">${fmtN(t.usdt)}</td>
    <td class="r">${op ? `<b data-live="${t.pair}" data-k="price">${S.prices[t.pair] ? fmtP(S.prices[t.pair]) : "–"}</b>` : "–"}</td>
    <td class="r">${isNaN(c.avgExit) ? "–" : fmtP(c.avgExit)}${t.exits.length ? `<div class="muted" style="font-size:11px">${fmtT(t.exits[t.exits.length - 1].t)}</div>` : ""}</td>
    <td class="r">${op ? fmtN(c.remPct, 0) + "%" : "zatvoreno"}</td>
    <td class="r"><b class="${cls(c.total)}" ${op ? `data-live="${t.pair}" data-k="jpl" data-jid="${t.id}"` : ""}>${jm(c.total)}</b></td>
    <td class="r"><span class="${cls(c.pct)}" ${op ? `data-live="${t.pair}" data-k="jpp" data-jid="${t.id}"` : ""}>${fmtPct(c.pct)}</span></td>
    <td class="r" style="white-space:nowrap">${op ? `<button class="btn sm" data-jx="${t.id}">Izlaz</button> ` : ""}<button class="btn sm" data-jedit="${t.id}">Uredi</button> <button class="x" data-jdel="${t.id}" aria-label="Obriši">×</button></td></tr>`; }).join("");
  return shell("Moj dnevnik", "Vaši stvarni ulazi i izlazi s Binancea: kada ste ušli, po kojoj cijeni, koliko USDT i kada ste izašli. Zarada uključuje proviziju.", dateBar() + `
  <div class="grid g4"><div class="card stat lift"><div class="sub">Realizirano</div><div class="v ${cls(tt.realized)}">${jm(tt.realized)} <span style="font-size:14px">USDT</span></div><div class="sub">${tt.cl} zatvorenih trejdova${tt.cl ? ", " + Math.round(tt.win / tt.cl * 100) + "% dobitnih" : ""}</div></div>
    <div class="card stat lift"><div class="sub">Otvoreno uživo</div><div class="v ${cls(tt.unreal)}">${jm(tt.unreal)} <span style="font-size:14px">USDT</span></div><div class="sub">neostvareno</div></div>
    <div class="card stat lift"><div class="sub">Ukupno</div><div class="v ${cls(tt.total)}">${jm(tt.total)} <span style="font-size:14px">USDT</span></div><div class="sub">realizirano + otvoreno</div></div>
    <div class="card stat lift"><div class="sub">Trenutno uloženo</div><div class="v">${fmtN(tt.inv)} <span style="font-size:14px">USDT</span></div><div class="sub">${a.filter(jOpen).length} otvorenih pozicija</div></div></div>
  <div class="card mt"><h2>Novi ulaz</h2><div class="sub">Upišite što ste stvarno kupili na Binanceu. Odaberite signal da se podaci sami popune.</div>
    <div class="jgrid"><div><label class="f">Signal (nije obavezno)</label><select class="txt" id="nsig"><option value="">Bez signala (ručni unos)</option>${sigs.map(s => `<option value="${esc(s.id)}" ${s.id === sigId ? "selected" : ""}>${esc(s.pair)} · pravi · ${fmtT(s.created)}</option>`).join("")}</select></div>
    <div><label class="f">Par</label><input class="txt" id="npair" list="jpairs" value="${pre ? esc(dn(pre.pair)) : ""}" placeholder="npr. SOLUSDT"><datalist id="jpairs">${pairs.map(p => `<option value="${dn(p)}">`).join("")}</datalist></div>
    <div><label class="f">Cijena ulaza (USDT)</label><input class="txt" id="np" inputmode="decimal" value="${pre ? fmtRaw(pre.entry) : ""}"></div>
    <div><label class="f">Uloženo (USDT)</label><input class="txt" id="nu" inputmode="decimal" placeholder="npr. 100"></div>
    <div><label class="f">Vrijeme ulaza</label><input class="txt" id="nt" type="datetime-local" value="${nowLocal()}"></div>
    <div><label class="f">Provizija po strani (%)</label><input class="txt" id="nf" inputmode="decimal" value="${lsGet("jfee", 0.1)}"></div></div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn primary" id="nsave">Spremi ulaz</button><button class="btn" id="jcsv">Izvezi CSV (sigurnosna kopija)</button></div></div>
  ${exForm}${edForm}
  <div class="card mt"><h2>Moji trejdovi</h2><table><tr><th>Par</th><th>Signal</th><th>Ulaz</th><th class="r">Cijena ulaza</th><th class="r">USDT</th><th class="r">Uživo</th><th class="r">Izlaz</th><th class="r">Preostalo</th><th class="r">Zarada USDT</th><th class="r">%</th><th></th></tr>
    ${rowsH || '<tr><td colspan="11" class="empty">Još nema unesenih trejdova.</td></tr>'}</table>
    <p class="note">Dnevnik se sprema na ovom računalu (u aplikaciji). Povremeno izvezite CSV kao sigurnosnu kopiju.</p></div>`);
}
const fmtRaw = v => String(+(+v).toPrecision(8));
function bindDnevnik(arg) {
  const num = id => parseFloat(String($(id).value).replace(",", "."));
  const sg = $("#nsig"); sg.addEventListener("change", () => { const s = S.rows.find(x => x.id === sg.value); if (s) { $("#npair").value = dn(s.pair); $("#np").value = fmtRaw(s.entry); } });
  $("#nsave").addEventListener("click", () => {
    const raw = $("#npair").value.trim().toUpperCase(), pair = isLatin(raw) ? realSym(raw.replace(/[^A-Z0-9]/g, "")) : raw, p = num("#np"), u = num("#nu"), f = num("#nf"), t = new Date($("#nt").value).getTime();
    if (!pair || !(p > 0) || !(u > 0) || !isFinite(t)) { toast("Upišite par, cijenu, iznos u USDT i vrijeme ulaza."); return; }
    const a = J(); a.push({ id: "j" + Date.now(), pair: pair.endsWith("USDT") ? pair : pair + "USDT", sig: sg.value, t, p, usdt: u, fee: isFinite(f) ? f : 0.1, exits: [] }); saveJ(a); lsSet("jfee", isFinite(f) ? f : 0.1);
    syncLive(); toast("Ulaz spremljen."); if (arg) location.hash = "#/dnevnik"; else render();
  });
  $("#jcsv").addEventListener("click", () => {
    const rows = [["par", "signal", "ulaz_vrijeme", "ulaz_cijena", "usdt", "provizija_pct", "izlazi(vrijeme:cijena:kolicina)"]].concat(J().map(t => [t.pair, t.sig, new Date(t.t).toISOString(), t.p, t.usdt, t.fee, t.exits.map(x => new Date(x.t).toISOString() + ":" + x.p + ":" + x.q).join("|")]));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })); a.download = "moj_dnevnik.csv"; a.click();
  });
  document.querySelectorAll("[data-jx]").forEach(b => b.addEventListener("click", () => { jExit = b.dataset.jx; render(); setTimeout(() => { const e = $("#xp"); if (e) e.select(); }, 50); }));
  document.querySelectorAll("[data-jedit]").forEach(b => b.addEventListener("click", () => { jEdit = b.dataset.jedit; render(); }));
  if ($("#esave")) {
    const close = () => { jEdit = ""; render(); }; $("#ecancel").addEventListener("click", close); $("#emodal").addEventListener("click", e => { if (e.target.id === "emodal") close(); });
    const keep = () => { const a = J(), t = a.find(x => x.id === jEdit); return [a, t]; };
    document.querySelectorAll("[data-xdel]").forEach(b => b.addEventListener("click", () => { if (!confirm("Obrisati ovaj izlaz?")) return; const [a, t] = keep(); t.exits.splice(+b.dataset.xdel, 1); saveJ(a); render(); }));
    $("#esave").addEventListener("click", () => {
      const [a, t] = keep(); const raw = $("#ep").value.trim().toUpperCase(), pair = isLatin(raw) ? realSym(raw.replace(/[^A-Z0-9]/g, "")) : raw, p = num("#ec"), u = num("#eu"), f = num("#ef"), tm = new Date($("#et").value).getTime();
      if (!pair || !(p > 0) || !(u > 0) || !isFinite(tm)) { toast("Provjeri par, cijenu, iznos i vrijeme."); return; }
      const oldQ = jqty(t); t.pair = pair.endsWith("USDT") ? pair : pair + "USDT"; t.p = p; t.usdt = u; t.t = tm; t.fee = isFinite(f) ? f : 0.1; const newQ = jqty(t);
      document.querySelectorAll("[data-xp]").forEach(e => { const i = +e.dataset.xp, xp = parseFloat(String(e.value).replace(",", ".")), xt = new Date(document.querySelector('[data-xt="' + i + '"]').value).getTime(); if (xp > 0) t.exits[i].p = xp; if (isFinite(xt)) t.exits[i].t = xt; t.exits[i].q = t.exits[i].q * newQ / oldQ; });
      saveJ(a); jEdit = ""; syncLive(); toast("Izmjene spremljene."); render(); });
  }
  document.querySelectorAll("[data-jdel]").forEach(b => b.addEventListener("click", () => { if (!confirm("Obrisati ovaj trejd iz dnevnika?")) return; saveJ(J().filter(t => t.id !== b.dataset.jdel)); syncLive(); render(); }));
  if ($("#xsave")) {
    $("#xcancel").addEventListener("click", () => { jExit = ""; render(); });
    $("#xmodal").addEventListener("click", e => { if (e.target.id === "xmodal") { jExit = ""; render(); } });
    $("#xsave").addEventListener("click", () => {
      const a = J(), t = a.find(x => x.id === jExit); if (!t) return; const p = num("#xp"), sh = num("#xs"), tm = new Date($("#xt").value).getTime();
      if (!(p > 0) || !(sh > 0 && sh <= 100) || !isFinite(tm)) { toast("Upišite cijenu izlaza, udio (1 do 100) i vrijeme."); return; }
      const rem = jqty(t) - jsold(t); t.exits.push({ t: tm, p, q: sh >= 99.999 ? rem : rem * sh / 100 }); saveJ(a); jExit = ""; syncLive(); toast("Izlaz spremljen."); render();
    });
  }
}

boot();
