/* Kripto signali – desktop aplikacija */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (k === "cfg") cfgMirror(v); };
/* pricuvna kopija postavki (token) u IndexedDB + zahtjev za trajnu pohranu: ako preglednik obrise localStorage, postavke se same vrate */
const idbOpen = () => new Promise((res, rej) => { try { const r = indexedDB.open("kripto-cfg", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
function cfgMirror(v) { try { if (!v || !v.token) return; idbOpen().then(db => { db.transaction("kv", "readwrite").objectStore("kv").put(JSON.stringify(v), "cfg"); }).catch(() => {}); } catch (e) {} }
async function cfgRestore() { try { if (cfg.token || cfg.demo) return false; const db = await idbOpen(); const v = await new Promise(res => { const q = db.transaction("kv").objectStore("kv").get("cfg"); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); if (!v) return false; const o = JSON.parse(v); if (!o.token) return false; cfg = Object.assign(cfg, o); cfg.demo = false; lsSet("cfg", cfg); return true; } catch (e) { return false; } }
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

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
const NAV = [["signali", "Signali: pravi i sjene", "sig", "t"], ["nova", "Nova strategija", "sig", "t"],
  ["moj", "Moj pregled", "wallet", "m"], ["dnevnik", "Moj dnevnik", "book", "m"], ["mojastat", "Moja statistika", "pie", "m"],
  ["pregled", "Pregled signala", "wallet", "s"], ["sdnevnik", "Dnevnik signala", "book", "s"], ["statistika", "Statistika signala", "pie", "s"],
  ["graf", "Graf uživo", "chart", "z"], ["arhiva", "Arhiva parova", "arch", "z"],
  ["postavke", "Postavke", "set", "x"]];

/* ---------------- podaci ---------------- */
async function refreshData(quiet) {
  const useDemo = cfg.demo || !cfg.token;
  try {
    if (useDemo) { if (S.source !== "demo" || !S.rows.length) S.rows = await loadDemo(); S.source = "demo"; S.err = ""; }
    else { S.rows = await loadRemote(cfg); S.source = "github"; S.err = ""; try { S.engine = await loadEngineAge(cfg); } catch (e) {} }
    S.updated = Date.now();
  } catch (e) { S.err = String(e.message || e); if (!S.rows.length) { S.rows = await loadDemo(); S.source = "demo"; } }
  try { const er = await fetch(`${BINANCE}/api/v3/ticker/price?symbol=EURUSDT`); const ej = await er.json(); if (+ej.price > 0) S.eur = +ej.price; } catch (e) {}
  notifyChanges(); jPull(); jAuto(); syncLive(); const sg = S.source + "|" + S.err + "|" + JSON.stringify(S.rows) + "|" + JSON.stringify(S.engine || "") + "|" + (S.eur || 0).toFixed(2); const same = quiet && sg === S.lastSig; S.lastSig = sg; if (!same && (!quiet || currentView !== "graf")) render(); topPills();
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
  if (prev) S.rows.forEach(r => { if (r.status === "skipped_capital" || isV2(r)) return; const o = prev[r.id], vr = isShadow(r) ? "sjena" : "PRAVI signal";
    if (o === undefined && isOpen(r)) notify(`Novi ${vr}${isShort(r) ? " SHORT" : ""}: ${dn(r.pair)}, ulaz ${fmtP(r.entry)}, stop ${fmtP(r.stop)}`);
    else if (o && o !== r.status && isClosed(r)) notify(`Zatvoren (${vr}): ${dn(r.pair)}, ${REASON_TXT[r.reason] || ""} ${fmtR(r.rnet)}`); });
  lsSet("seenSig", cur);
}
function realRows() { return S.rows.filter(s => s.status !== "skipped_capital" && !isV2(s)); }

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
  else if ((k === "spl" || k === "spp") && el.dataset.sid) { const q = S.rows.find(x => x.id === el.dataset.sid); if (q) { const sd = sdOf(q), pc = sd * (p / q.entry - 1) * 100, usd = (q.pnl || 0) + q.pos * (isFinite(q.remaining) ? q.remaining : 1) * sd * (p / q.entry - 1); t = k === "spl" ? jm(usd) : fmtPct(pc); c2 = cls(k === "spl" ? usd : pc); } }
  else if (s && (k === "gem" || k === "gfl" || k === "rr")) { const rv = (isShort(s) ? s.entry - p : p - s.entry) / Math.abs(s.entry - s.stop), ps = gPos(rv); c = rCls(rv); if (k === "gem") el.style.left = ps + "%"; else if (k === "gfl") { el.style.left = Math.min(ps, 21.4) + "%"; el.style.width = Math.abs(ps - 21.4) + "%"; } else t = fmtR(rv); }
  else if (k === "price") t = fmtP(p);
  else if (k === "pct") { const o = S.open24[pair]; if (o) { const v = (p / o - 1) * 100; t = fmtPct(v); c = cls(v); } }
  else if (s && k === "r") { const r = (p - s.entry) / (s.entry - s.stop); t = fmtR(r); c = cls(r); }
  else if (s && k === "t1") { t = fmtPct((s.t1 / p - 1) * 100); }
  else if (s && k === "st") { t = fmtPct((s.stop / p - 1) * 100); }
  else if (s && k === "state") { const sh = isShort(s), hit = sh ? (p <= s.t3 ? "T3 dosegnut" : p <= s.t2 ? "T2 dosegnut" : p <= s.t1 ? "T1 dosegnut" : p >= s.stop ? "Iznad stopa" : "U tijeku") : (p >= s.t3 ? "T3 dosegnut" : p >= s.t2 ? "T2 dosegnut" : p >= s.t1 ? "T1 dosegnut" : p <= s.stop ? "Ispod stopa" : "U tijeku"), stopHit = sh ? p >= s.stop : p <= s.stop, t1Hit = sh ? p <= s.t1 : p >= s.t1; t = hit; c = stopHit ? "down" : t1Hit ? "up" : ""; }
  if (el.textContent !== t) el.textContent = t; if (c2) c = c2; if (c !== undefined && k !== "price") el.className = (el.className.replace(/\b(up|down)\b/g, "").trim() + " " + c).trim();
}
function paintLive() { document.querySelectorAll("[data-live]").forEach(liveVal); moneyRefresh(); if ((currentView === "graf" || currentView === "signali") && chart && chartState.pair && S.prices[chartState.pair]) { chart.setLive(S.prices[chartState.pair]); paintChartHead(); } topPills(); }
setInterval(() => topPills(), 2000);

/* ---------------- okvir ---------------- */
let currentView = "", chart = null, kws = null;
function topPills() {
  const el = $("#pills"); if (!el) return;
  const fresh = Date.now() - S.tick < 15000; let h = "";
  h += S.tick ? (fresh ? '<span class="pill live"><span class="dot"></span>Cijene uživo</span>' : '<span class="pill warn"><span class="dot"></span>Veza kasni…</span>') : '<span class="pill warn"><span class="dot"></span>Povezivanje…</span>';
  h += S.source === "demo" ? (!cfg.token && !cfg.demo ? '<a href="#/postavke" class="pill demo" style="color:#ff5a5f;border-color:#ff5a5f;font-weight:800">⚠ NEMA TOKENA – prikazani su izmišljeni podaci. Upiši token u Postavkama.</a>' : '<span class="pill demo">Primjer podataka</span>') : `<span class="pill">GitHub · ${S.updated ? fmtHM(S.updated) : "–"}</span>`;
  if (S.source === "github" && S.engine) { const m = Math.round((Date.now() - S.engine) / 60000), t = m < 90 ? "pill" : m < 180 ? "pill warn" : "pill err"; h += `<span class="${t}" title="Engine se pokreće svakog sata i nakon svakog alarma. Ako je ovdje crveno, provjerite GitHub Actions.">Engine · ${m < 60 ? "prije " + m + " min" : "prije " + Math.floor(m / 60) + " h " + (m % 60) + " min"}</span>`; }
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
const PUBLIC_URL = "https://tomek0608.github.io/kripto-app/";
/* prijenos postavki s racunala na mobitel: poveznica nosi postavke u dijelu iza #, koji se nikad ne salje poslužitelju */
function importFromHash() {
  const m = /^#\/prenos=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return false;
  try { const o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))))); cfg = Object.assign(cfg, { repo: o.repo || cfg.repo, branch: o.branch || cfg.branch, token: o.token || cfg.token }); if (o.wtoken) cfg.wtoken = o.wtoken; cfg.demo = false; lsSet("cfg", cfg); history.replaceState(null, "", location.pathname + "#/signali"); setTimeout(() => toast("Postavke su prenesene. Obriši poruku s poveznicom."), 600); return true; } catch (e) { history.replaceState(null, "", location.pathname + "#/postavke"); return false; }
}
function transferLink() { const o = { repo: cfg.repo, branch: cfg.branch, token: cfg.token }; if (cfg.wtoken) o.wtoken = cfg.wtoken; return PUBLIC_URL + "#/prenos=" + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function boot() {
  importFromHash();
  cfgMirror(cfg); cfgRestore().then(ok => { if (ok) { S.source = "x"; refreshData(); toast("Postavke su vraćene iz pričuvne kopije."); } });
  document.documentElement.dataset.theme = lsGet("theme2", "reel");
  $("#root").innerHTML = `<canvas id="bg"></canvas><div class="veil"></div><div class="app"><aside class="rail"><div class="mark">T</div>
    ${NAV.filter(n => n[0] !== "postavke").map(([id, t, ic, g], i, a) => (i && a[i - 1][3] !== g ? '<div class="rsep"></div>' : "") + `<a class="ri g${g}" href="#/${id}" data-nav="${id}">${svg(ICON[ic])}<span class="tip">${t}</span></a>`).join("")}
    <div class="grow"></div><button class="ri" id="themebtn" aria-label="Promijeni temu"></button>
    <a class="ri" href="#/postavke" data-nav="postavke">${svg(ICON.set)}<span class="tip">Postavke</span></a></aside>
    <main class="main" id="main"><div class="topbar"><div class="crumb gl">Kripto signali <span>›</span> <b id="crumb">Pregled</b></div>
      <div class="tb-right"><div class="pills" id="pills"></div><div class="clock gl" id="clock">–</div>
        <a class="ibtn gl" href="#/signali" id="bell" aria-label="Otvoreni signali">${svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 0 0 4 0"/>')}<span class="dot" id="belldot" style="display:none"></span></a>
        <a class="ibtn avatar" href="#/postavke" aria-label="Postavke">TP</a></div></div><div id="page"></div></main></div>`;
  setTheme(lsGet("theme2", "reel")); $("#themebtn").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(document.documentElement.dataset.theme) + 1) % THEMES.length]));
  const tick = () => { const d = new Date(); $("#clock").textContent = new Intl.DateTimeFormat("hr-HR", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); }; tick(); setInterval(tick, 10000);
  try { if ("serviceWorker" in navigator && /^https:|^http:\/\/localhost/.test(location.href)) navigator.serviceWorker.register("sw.js").catch(() => {}); } catch (e) {}
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-mt]"); if (!b) return; moneyTab = b.dataset.mt; const h = document.getElementById("moneyblk"); if (h) { moneyAt = Date.now(); const m = $("#main"), sc = m ? m.scrollTop : 0; h.outerHTML = moneyBlock(h.dataset.src); if (m) m.scrollTop = sc; } });
  window.addEventListener("hashchange", render); render(); refreshData(); setInterval(() => refreshData(true), Math.max(20, cfg.refresh) * 1000);
}
function route() { const h = location.hash.replace(/^#\/?/, "").split("/"); return { view: h[0] || "signali", arg: decodeURIComponent(h[1] || "") }; }
let renderTok = 0, lastArg = "", sigListScroll = 0;
let NOVA = false;
const NOVA_MAX = 0.08;
const isNarrow = () => NOVA || window.matchMedia("(max-width:1180px)").matches;
function render() {
  const { view, arg } = route(); const prev = currentView; let next = NAV.some(n => n[0] === view) ? view : "signali"; const isN = next === "nova"; if (isN) next = "signali"; const anim = !/^(statistika|mojastat|sdnevnik)$/.test(next); const changed = prev !== next && prev !== ""; const page = $("#page"), tok = ++renderTok;
  const go = () => { if (tok !== renderTok) return;
    NOVA = isN; currentView = next; if (chart && (prev === "graf" || prev === "signali")) { chart.destroy(); chart = null; } if (kws) { kws.onclose = null; try { kws.close(); } catch (e) {} kws = null; }
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === (NOVA ? "nova" : currentView))); $("#crumb").textContent = (NAV.find(n => n[0] === (NOVA ? "nova" : currentView)) || [])[1];
    const main = $("#main"), sc = main.scrollTop; const V = { moj: vMoj, pregled: vPregled, signali: vSignali, graf: vGraf, arhiva: vArhiva, dnevnik: vDnevnik, statistika: vStatSig, sdnevnik: vSDnevnik, mojastat: vStatMoja, usporedba: vUsporedba, postavke: vPostavke, nova: vNova }[currentView];
    page.className = anim && (changed || prev === "") ? "enter" : ""; window.__sheetHtml = ""; page.innerHTML = V(arg);
    if (page.className === "enter") page.querySelectorAll(".page-head,.chartbar,.card,.item,.chartwrap").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 9)));
    if (currentView === "signali" && prev === "signali") { if (arg && !lastArg) sigListScroll = sc; main.scrollTop = arg === lastArg ? sc : (arg ? 0 : sigListScroll); } else main.scrollTop = prev === currentView ? sc : 0; lastArg = arg || ""; topPills(); bind(arg); paintLive(); const open = S.rows.some(s => s.status === "open"); const bd = $("#belldot"); if (bd) bd.style.display = open ? "block" : "none"; };
  if (changed && anim && page.innerHTML) { page.classList.remove("enter"); page.classList.add("leaving"); setTimeout(() => { page.classList.remove("leaving"); go(); }, 170); } else go();
}
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 4200); }
const kindTag = s => { const sf = isShort(s) ? " · SHORT" : ""; return isSR(s) ? '<span class="tag shadow">Sjena · S/R' + sf + '</span>' : isShadow(s) ? '<span class="tag shadow">Sjena' + sf + '</span>' : isShort(s) ? '<span class="tag short">Pravi · SHORT</span>' : '<span class="tag real">Pravi</span>'; };
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
  const openOnly = open.filter(s => s.kind === "real"), openPnl = openOnly.reduce((a, s) => { const p = S.prices[s.pair], rem = isFinite(s.remaining) ? s.remaining : 1, part = (isFinite(s.grossR) ? s.grossR : 0) * s.risk; return a + part + (p ? s.pos * rem * sdOf(s) * (p / s.entry - 1) : 0); }, 0), eqLive = eq + openPnl;
  const hr = +new Intl.DateTimeFormat("en", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()) % 24, greet = hr < 10 ? "Dobro jutro" : hr < 18 ? "Dobar dan" : "Dobra večer";
  const reasons = {}; real.forEach(s => reasons[s.reason] = (reasons[s.reason] || 0) + 1);
  const rb = ["T3", "stop_na_ulazu", "stop", "isteklo"].map(k => { const n = reasons[k] || 0, pc = real.length ? n / real.length * 100 : 0; const col = k === "stop" ? "var(--down)" : k === "isteklo" ? "var(--gray)" : "var(--up)";
    return `<div class="row-bar"><span>${REASON_TXT[k]}</span><div class="bar"><div style="width:${pc}%;background:${col}"></div></div><b class="r">${pc.toFixed(0)}%</b></div>`; }).join("")
    + (() => { const allR = rows.filter(s => s.kind === "real"), n = allR.length; return `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--edge)"><div class="muted" style="margin-bottom:6px">Dosegnuti ciljevi (svi pravi signali, i otvoreni)</div>` + ["T1", "T2", "T3"].map(t => `<div class="kv"><span>Dosegnuo ${t}</span><b>${allR.filter(s => s.hit.includes(t)).length} od ${n}</b></div>`).join("") + `</div><div class="muted" style="margin-top:12px;font-size:12px;line-height:1.5"><b>Cilj T3</b>: zatvoreno na zadnjem cilju (4R). <b>T1, pa ulaz</b>: cijena je dosegla T1 (pola pozicije prodano s dobitkom), pa se vratila na ulaz i ostatak je zatvoren na nuli. <b>Stop</b>: udaren početni stop (gubitak, −1R). <b>Istek</b>: signal je istekao nakon 72 sata i zatvoren po tadašnjoj cijeni.</div>`; })();
  const avgScore = real.length || open.length ? [...real, ...open].reduce((a, s) => a + s.score, 0) / (real.length + open.length) : NaN;
  const recent = rows.filter(s => s.kind === "real").sort((a, b) => b.created - a.created).slice(0, 8);
  const openT = open.length ? `<table><tr><th>Par</th><th class="r">Cijena uživo</th><th class="r">24h</th><th class="r">Ulaz</th><th class="r">Do T1</th><th class="r">Do stopa</th><th class="r">Uživo R</th><th>Stanje</th></tr>${open.map(s => `<tr class="click" data-go="#/signali/${esc(s.id)}"><td>${coin(s.pair)}</td>
    <td class="r"><b data-live="${s.pair}" data-k="price">–</b></td><td class="r"><span data-live="${s.pair}" data-k="pct">–</span></td><td class="r">${fmtP(s.entry)}</td>
    <td class="r" data-live="${s.pair}" data-k="t1" data-sid="${esc(s.id)}">–</td><td class="r" data-live="${s.pair}" data-k="st" data-sid="${esc(s.id)}">–</td>
    <td class="r"><b data-live="${s.pair}" data-k="r" data-sid="${esc(s.id)}">–</b></td><td><span data-live="${s.pair}" data-k="state" data-sid="${esc(s.id)}">–</span></td></tr>`).join("")}</table>` : '<div class="empty">Trenutno nema otvorenih signala.</div>';
  const sigBody = `
  <div class="grid g4">
    <div class="card hero lift ${eqLive >= START_EQUITY ? "pos" : ""}"><div class="sub">Fiktivni račun</div><div class="big">${fmtN(eq)} <span style="font-size:16px;font-weight:500">USDT</span></div><span class="chip">${fmtPct((eq / START_EQUITY - 1) * 100)} od početnih ${fmtN(START_EQUITY, 0)}</span><div class="sub" style="margin-top:10px;opacity:.9">Računa se samo zatvoreno. Uz otvorene signale (uživo): <b>${fmtN(eqLive)} USDT</b> (${jm(openPnl)})</div></div>
    <div class="card stat lift"><div class="sub">Uspješnost</div><div class="v">${sm ? sm.win.toFixed(0) + "%" : "–"}</div><div class="sub">${real.length} zatvorenih signala</div></div>
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
  return shell("Moj pregled", "", mojPregled());
}
/* stanje racuna: pri svakom otvaranju aplikacije je prekriveno, oko ga otkriva; uz USDT i iznos u eurima (tecaj EURUSDT s Binancea) */
let balHidden = true;
const MASK = "••••••";
const eurTxt = v => S.eur > 0 ? fmtN(v / S.eur) + " €" : "– €";
const eyeBtn = () => `<button class="btn sm" data-eye title="${balHidden ? "Prikaži stanje" : "Sakrij stanje"}" aria-label="${balHidden ? "Prikaži stanje" : "Sakrij stanje"}" style="padding:4px 9px;line-height:1;display:inline-flex;align-items:center">${balHidden ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'}</button>`;
function mojPregled() {
  const a = J(), tt = jTotals(), cl = a.filter(t => !jOpen(t)), op = a.filter(jOpen);
  const cc = cl.map(t => ({ t, c: jcalc(t) })), wins = cc.filter(x => x.c.realized > 0), gw = wins.reduce((s, x) => s + x.c.realized, 0), gl = -cc.filter(x => x.c.realized <= 0).reduce((s, x) => s + x.c.realized, 0);
  const avgPct = cc.length ? cc.reduce((s, x) => s + x.c.pct, 0) / cc.length : NaN;
  const openT = op.length ? `<table><tr><th>Par</th><th>Signal</th><th class="r">Ulaz</th><th class="r">Cijena uživo</th><th class="r">Uloženo</th><th class="r">Zarada USDT</th><th class="r">%</th></tr>${op.map(t => { const sg = S.rows.find(x => x.id === t.sig), c = jcalc(t, S.prices[t.pair]);
    return `<tr class="click" data-go="#/dnevnik"><td>${coin(t.pair)}</td><td>${sg ? kindTag(sg) : '<span class="muted">ručno</span>'}</td><td class="r">${fmtP(t.p)}</td><td class="r"><b data-live="${t.pair}" data-k="price">${S.prices[t.pair] ? fmtP(S.prices[t.pair]) : "–"}</b></td><td class="r">${fmtN(c.rem * t.p)}</td>
    <td class="r"><b class="${cls(c.total)}" data-live="${t.pair}" data-k="jpl" data-jid="${t.id}">${jm(c.total)}</b></td><td class="r"><span class="${cls(c.pct)}" data-live="${t.pair}" data-k="jpp" data-jid="${t.id}">${fmtPct(c.pct)}</span></td></tr>`; }).join("")}</table>` : '<div class="empty">Nemaš otvorenih trejdova. Ulaz upiši u "Moj dnevnik" ili preko gumba na signalu.</div>';
  const recent = [...cc].sort((x, y) => y.t.exits[y.t.exits.length - 1].t - x.t.exits[x.t.exits.length - 1].t).slice(0, 5);
  const recT = recent.length ? `<table><tr><th>Par</th><th>Izlaz</th><th class="r">Cijena izlaza</th><th class="r">Zarada USDT</th><th class="r">%</th></tr>${recent.map(x => `<tr><td>${coin(x.t.pair)}</td><td class="muted">${fmtT(x.t.exits[x.t.exits.length - 1].t)}</td><td class="r">${fmtP(x.c.avgExit)}</td><td class="r ${cls(x.c.realized)}"><b>${jm(x.c.realized)}</b></td><td class="r ${cls(x.c.pct)}">${fmtPct(x.c.pct)}</td></tr>`).join("")}</table>` : '<div class="empty">Još nema zatvorenih trejdova.</div>';
  const st0 = mojStart();
  const sorted = [...cc].sort((x, y) => x.t.exits[x.t.exits.length - 1].t - y.t.exits[y.t.exits.length - 1].t);
  let cum = st0 > 0 ? st0 : 0; const first = sorted[0] ? sorted[0].t.t : Date.now(); const pts = [{ t: first, v: cum }]; sorted.forEach(x => { cum += x.c.realized; pts.push({ t: x.t.exits[x.t.exits.length - 1].t, v: cum }); }); pts.push({ t: Date.now(), v: cum });
  let peak = -Infinity, dd = 0; pts.forEach(p => { peak = Math.max(peak, p.v); dd = Math.max(dd, peak - p.v); });
  const dur = cc.length ? cc.reduce((s, x) => s + (x.t.exits[x.t.exits.length - 1].t - x.t.t), 0) / cc.length : NaN;
  const durTxt = isNaN(dur) ? "–" : dur >= 864e5 ? fmtN(dur / 864e5, 1) + " dana" : fmtN(dur / 36e5, 1) + " h";
  const bar = (lab, n, col) => { const pc = cc.length ? n / cc.length * 100 : 0; return `<div class="row-bar"><span>${lab}</span><div class="bar"><div style="width:${pc}%;background:${col}"></div></div><b class="r">${pc.toFixed(0)}%</b></div>`; };
  const nl = cc.length - wins.length;
  return `<div class="grid g4">
    <div class="card hero lift ${tt.total >= 0 ? "pos" : ""}"><div class="sub" style="display:flex;justify-content:space-between;align-items:center">Moj račun ${eyeBtn()}</div><div class="big">${balHidden ? MASK : st0 > 0 ? fmtN(st0 + tt.total) : jm(tt.total)} <span style="font-size:16px;font-weight:500">USDT</span></div><div class="sub" style="margin-top:2px;font-size:16px">≈ ${balHidden ? MASK : eurTxt(st0 > 0 ? st0 + tt.total : tt.total)}</div><span class="chip">${balHidden ? MASK : st0 > 0 ? fmtPct(tt.total / st0 * 100) + " od početnih " + fmtN(st0, 0) : "rezultat · realizirano " + jm(tt.realized) + " · otvoreno " + jm(tt.unreal)}</span><div style="margin-top:10px"><button class="btn sm" id="setstart">${st0 > 0 ? "Promijeni početni račun" : "Postavi početni račun"}</button></div></div>
    <div class="card stat lift"><div class="sub">Uspješnost</div><div class="v">${cc.length ? Math.round(wins.length / cc.length * 100) + "%" : "–"}</div><div class="sub">${cc.length} zatvorenih trejdova</div></div>
    <div class="card stat lift"><div class="sub">Prosjek po trejdu</div><div class="v ${cls(avgPct)}">${cc.length ? fmtPct(avgPct) : "–"}</div><div class="sub">nakon provizije</div></div>
    <div class="card stat lift"><div class="sub">Profit factor</div><div class="v">${cc.length ? (gl > 0 ? fmtN(gw / gl) : gw > 0 ? "∞" : "–") : "–"}</div><div class="sub">dobici / gubici</div></div></div>
  <div class="card mt"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2>Moji otvoreni trejdovi · uživo</h2></div><a class="btn" href="#/dnevnik">Moj dnevnik</a></div>${openT}</div>
  <div class="grid g2 mt">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><h2>Statistika računa</h2><div class="sub">USDT, nakon zatvorenih trejdova</div></div>
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
  const unreal = op.reduce((a, s) => { const p = S.prices[s.pair]; return a + (p ? (s.pnl || 0) + s.pos * (isFinite(s.remaining) ? s.remaining : 1) * sdOf(s) * (p / s.entry - 1) : (s.pnl || 0)); }, 0);
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
    const dIn = sdOf(sg) * (t.p / sg.entry - 1) * 100, sx = sigExitPrice(sg), sp = sigPct(sg), mp = c.pct;
    const myExT = t.exits.length ? t.exits[t.exits.length - 1].t : NaN, dOut = fin ? sdOf(sg) * (c.avgExit / sx - 1) * 100 : NaN;
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
const sigFilter = { f: "svi", q: "", d: "sve", o: "bodovi", s: "otvoreni", sd: "sve", tf: "sve", nj: false, x: "" }, sdFilter = { f: "pravi", q: "" };
const sigExitPrice = s => (isFinite(s.grossR) && s.entry - s.stop) ? s.entry + s.grossR * (s.entry - s.stop) : NaN;
const sigPct = s => isFinite(s.rnet) && s.entry ? s.rnet * Math.abs(s.entry - s.stop) / s.entry * 100 : NaN;
function parseReasons(txt) {
  const items = [], notes = [];
  String(txt).split("\n").forEach(line => { const m = line.match(/^- (.+?) \((\d+)\/(\d+)\): (.*)$/);
    if (m) items.push({ name: m[1], v: +m[2], max: +m[3], text: m[4] }); else if (line.trim()) notes.push(line.replace(/^- /, "")); });
  const tr = items.filter(i => i.name.startsWith("Trend")), rest = items.filter(i => !i.name.startsWith("Trend"));
  const out = []; if (tr.length) out.push({ name: "Trend", v: tr.reduce((a, b) => a + b.v, 0), max: tr.reduce((a, b) => a + b.max, 0), text: tr.map(t => t.name.replace("Trend ", "").replace(/^./, c => c.toUpperCase()) + ": " + t.text).join(" · ") });
  return { items: out.concat(rest), notes };
}
/* ---- detaljna obrazloženja ocjene ---- */
const CRIT_INTRO = {
  "Trend": "Je li cijena u uzlaznom trendu. Gledaju se tri uvjeta (po 5 bodova) na dva okvira: dnevni (veliki smjer) i 4h (srednji rok). Signal je pouzdaniji kad se oba okvira slažu. Maksimum 30.",
  "Momentum": "Koliko je snažan zamah rasta upravo sada. Gleda se RSI (snaga rasta od 0 do 100) na 4h i 1h te MACD histogram (ubrzava li rast). Zdrav rast je RSI od 60 do 75; iznad 75 je prekupljeno, pa je to slabije bodovano jer je povlačenje vjerojatnije. Maksimum 15.",
  "Volumen": "Prati li rast stvarni novac. Gleda se volumen zadnje 1h svijeće u odnosu na prosjek zadnjih 20 svijeća i OBV (kumulativni volumen: raste li kupovni pritisak). Rast bez volumena često ne drži. Maksimum 20.",
  "Struktura": "Je li cijena probila važnu razinu. Proboj 20-svijećnog maksimuma znači da je cijena viša nego u zadnjih 20 svijeća, što je klasičan znak nastavka rasta. Ako nema proboja, bod dobiva blizina 4h podrške (blizu dna, uz mali stop). Maksimum 15.",
  "Divergencije": "Rani znak preokreta ili nastavka. Bikovska divergencija: cijena pravi niži minimum, a indikator (RSI, MACD ili OBV) viši, pa pad slabi. Skrivena bikovska: cijena viši minimum, a indikator niži, uz uzlazni trend, što je znak nastavka rasta. Računa se samo ako je potvrđena probojem ili zelenom svijećom s volumenom. Sve ili ništa: 10 ili 0.",
  "Fundamenti, zamjenski": "Zasad nemamo vijesti, TVL ni funding, pa se koriste zamjenski pokazatelji: raste li promet kovanice (interes tržišta) i drži li se bolje od Bitcoina zadnjih 7 dana. Maksimum 10."
};
function critHtml(i, sel) {
  const t = i.text, has = s => t.indexOf(s) >= 0, num = re => { const m = t.match(re); return m ? parseFloat(m[1]) : NaN; };
  const row = (ok, txt, pts) => `<div style="display:flex;gap:10px;align-items:baseline;margin:3px 0;font-size:12.5px"><span style="width:14px;color:${ok ? "var(--up)" : "var(--down)"}">${ok ? "✓" : "✗"}</span><span style="flex:1;${ok ? "" : "opacity:.65"}">${txt}</span><b class="${ok ? "up" : "muted"}" style="min-width:34px;text-align:right">${ok ? "+" : ""}${pts}</b></div>`;
  let rows = "";
  if (i.name === "Trend") {
    const parts = t.split(" · ");
    parts.forEach(p => { const lab = /^Dnevni/.test(p) ? "Dnevni okvir (1d)" : "Okvir 4h";
      rows += `<div style="margin-top:8px"><b style="font-size:12.5px">${lab}</b>` + row(p.indexOf("cijena>EMA50") >= 0, "Cijena je iznad EMA50 (prosjek zadnjih 50 svijeća)", 5) + row(p.indexOf("EMA20>EMA50") >= 0, "EMA20 je iznad EMA50 (kratki prosjek preko dužeg)", 5) + row(p.indexOf("EMA50>EMA200") >= 0, "EMA50 je iznad EMA200 (dugoročni uzlazni trend)", 5) + "</div>"; });
  } else if (i.name === "Momentum") {
    const r4 = num(/RSI 4h (\d+)/), r1 = num(/RSI 1h (\d+)/);
    rows += row(r4 >= 50 && r4 < 60, "RSI 4h između 50 i 60 (rast tek počinje)", 5) + row(r4 >= 60 && r4 <= 75, "RSI 4h između 60 i 75 (jak, zdrav rast)", 8) + row(r4 > 75, "RSI 4h iznad 75 (prekupljeno" + (r4 > 75 ? ", sada " + r4 : "") + "; manje bodova, veći rizik povlačenja)", 3)
      + row(r1 > 50, "RSI 1h iznad 50" + (isFinite(r1) ? " (sada " + r1 + ")" : ""), 3) + row(has("MACD 4h raste iznad 0"), "MACD histogram 4h iznad nule i raste (zamah ubrzava)", 4) + (has("MACD 4h raste iznad 0") ? "" : row(has("MACD 4h iznad 0"), "MACD histogram 4h iznad nule, ali ne raste", 2));
  } else if (i.name === "Volumen") {
    const vr = num(/volumen 1h ([\d.]+)x/);
    rows += row(vr >= 1.5, "Zelena 1h svijeća s volumenom od 1,5× prosjeka ili više" + (isFinite(vr) ? " (sada " + vr.toFixed(1) + "×)" : ""), 10) + row(vr >= 1.2 && vr < 1.5, "Zelena 1h svijeća s volumenom od 1,2× do 1,5× prosjeka", 6) + row(has("OBV 4h iznad prosjeka"), "OBV na 4h iznad svog prosjeka (kupovni pritisak)", 5) + row(has("OBV 1h raste"), "OBV na 1h raste zadnjih 20 svijeća", 5);
  } else if (i.name === "Struktura") {
    const b4 = has("20-svijecnog maksimuma (4h)"), b1 = has("20-svijecnog maksimuma (1h)");
    rows += row(b4, "Proboj 20-svijećnog maksimuma na 4h", 10) + row(b1, "Proboj 20-svijećnog maksimuma na 1h", 5) + row(has("blizu 4h podrske"), "Nema proboja, ali je cijena blizu 4h podrške", 8);
  } else if (i.name === "Divergencije") {
    const ok = !has("nema potvrdene");
    rows += row(ok, ok ? "Potvrđena divergencija: " + esc(t) : "Nema potvrđene bikovske divergencije na RSI, MACD ni OBV (1h i 4h)", 10);
  } else if (i.name === "Fundamenti, zamjenski") {
    const r = num(/volumen 24h ([\d.]+)x/), up = has("iznad 7d prosjeka");
    rows += row(up, "Promet 24h veći od 1,3× prosjeka zadnjih 7 dana" + (isFinite(r) ? " (sada " + r.toFixed(1) + "×)" : ""), 5) + row(!up && has("7d prosjeka"), "Promet 24h veći od 7-dnevnog prosjeka" + (isFinite(r) && !up ? " (sada " + r.toFixed(1) + "×)" : ""), 3) + row(has("naspram BTC"), "Kovanica je zadnjih 7 dana bolja od Bitcoina", 5) + (has("naspram BTC") ? `<div class="note" style="margin-top:4px">${esc((t.match(/7d [^,]*naspram BTC [^,]*/) || [""])[0])}</div>` : "");
  } else return `<div class="note">${esc(t)}</div>`;
  return `<div class="note" style="margin:6px 0 4px;line-height:1.5">${CRIT_INTRO[i.name] || ""}</div>${rows}`;
}
function sigSummary(items, sel) {
  const by = {}; items.forEach(i => by[i.name] = i);
  const best = items.filter(i => i.max && i.v / i.max >= .99).map(i => i.name + " " + i.v + "/" + i.max), weak = items.filter(i => i.max && i.v / i.max < .4).map(i => i.name + " " + i.v + "/" + i.max);
  const warn = [], mm = by["Momentum"] ? by["Momentum"].text : "", rr = mm.match(/RSI 4h (\d+)/);
  if (rr && +rr[1] > 75) warn.push("RSI na 4h je " + rr[1] + " (prekupljeno): cijena je već snažno narasla, pa je povlačenje vjerojatnije i ulaz je rizičniji.");
  if (by["Trend"] && /Dnevni: 1d: nema uvjeta/.test(by["Trend"].text)) warn.push("Dnevni trend nema nijedan uvjet: veliki smjer još nije potvrđen, signal se oslanja na kraće okvire.");
  if (isShort(sel) && rr && +rr[1] < 25) warn.push("RSI na 4h je " + rr[1] + " (prodano): cijena je već snažno pala, pa je odskok vjerojatniji i SHORT ulaz je rizičniji.");
  if (sel.stop && sel.entry && Math.abs(sel.entry - sel.stop) / sel.entry > .08) warn.push("Stop je daleko od ulaza (" + fmtN(Math.abs(sel.entry - sel.stop) / sel.entry * 100, 1) + "%), pa je pozicija manja da rizik ostane 1% računa.");
  return `<div class="note" style="line-height:1.55;margin-top:6px"><b>Ukratko:</b> ocjena ${sel.score}/100 (pravi signal od 65, sjena od 55). ${best.length ? "Najjači dijelovi: " + best.join(", ") + ". " : ""}${weak.length ? "Najslabiji: " + weak.join(", ") + "." : ""}</div>${warn.length ? `<div class="note" style="margin-top:6px;line-height:1.5"><b>Na što paziti:</b><br>${warn.map(w => "• " + esc(w)).join("<br>")}</div>` : ""}`;
}
const STOP_INFO = `<div class="note" style="margin-top:10px;line-height:1.55"><b>Kako se računaju stop i ciljevi:</b> stop je bliži od dvije udaljenosti, 1,5× ATR (prosječni raspon 1h svijeće) ili razmak do zadnjeg 1h minimuma u 48 sati, ali najmanje 0,5% od ulaza. Ciljevi su višekratnici rizika: T1 = 2R (prodaje se 50%), T2 = 3R (25%), T3 = 4R (25%). Nakon T1 stop se pomiče na ulaz, pa ostatak više ne može donijeti gubitak. Veličina pozicije je takva da gubitak na stopu iznosi 1% fiktivnog računa.</div>`;
function sigDetail(sel, onChart, mid) {
    if (isV2(sel)) return sigDetailV2(sel, onChart, mid);
    const pr = parseReasons(sel.reasons), op = isOpen(sel);
    const lv = (lab, v, c, k) => `<div class="kv"><span>${lab}</span><span style="display:flex;gap:14px"><b class="${c || ""}">${fmtP(v)}</b>${op ? `<span class="muted" style="min-width:64px;text-align:right" data-live="${sel.pair}" data-k="${k}" data-sid="${esc(sel.id)}"></span>` : ""}</span></div>`;
    const hitTxt = sel.hit.length ? sel.hit.map(h => h + " ✓").join(" · ") : "Čeka prvi cilj (T1)";
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap"><div><h2 style="font-size:22px;font-weight:600">${esc(dn(sel.pair))} · ${isSR(sel) ? "SJENA · S/R" + (isShort(sel) ? " · SHORT" : "") + " (probni, nije za ulazak)" : isShadow(sel) ? "SJENA" + (isShort(sel) ? " · SHORT" : "") + " (probni, nije za ulazak)" : "PRAVI · " + (isShort(sel) ? "SHORT" : "LONG")}</h2>
      <div class="sub" style="margin-top:4px">Okvir ${sel.tf} · otvoren ${fmtT(sel.created)} · vrijedi do ${fmtT(sel.expires)} · strategija v1</div></div>
      <div style="text-align:right"><div class="score"><b>${sel.score}</b><span class="muted">/ 100</span></div></div></div>
      <div class="grid g2 mt" style="grid-template-columns:1fr 1fr;gap:28px"><div>
      ${lv("Ulaz", sel.entry, "", "")}${lv("Stop (" + fmtPct((sel.stop / sel.entry - 1) * 100) + ")", sel.stop, "down", "st")}${lv("T1 · 2R · 50%", sel.t1, "up", "t1")}${lv("T2 · 3R · 25%", sel.t2, "up", "")}${lv("T3 · 4R · 25%", sel.t3, "up", "")}</div>
      <div><div class="kv"><span>Status</span><span>${statusTag(sel)}</span></div>${op ? `<div class="kv"><span>Uživo</span><b data-live="${sel.pair}" data-k="r" data-sid="${esc(sel.id)}">–</b></div>` : `<div class="kv"><span>Izlaz</span><b>${REASON_TXT[sel.reason] || "–"} · ${fmtT(sel.exit)}</b></div><div class="kv"><span>Prosječna cijena izlaza</span><b>${fmtP(sigExitPrice(sel))} (${fmtPct(sigPct(sel))})</b></div>`}
      <div class="kv"><span>Ciljevi</span><b>${hitTxt}</b></div><div class="kv"><span>Rizik / pozicija</span><b>${sel.risk ? fmtN(sel.risk) + " / " + fmtN(sel.pos, 0) + " USDT" : "bez pozicije (sjena)"}</b></div>
      ${isFinite(sel.mfe) && isFinite(sel.mae) ? `<div class="kv"><span>Najveći plus (u R)</span><b class="up">${fmtR(sel.mfe)}</b></div><div class="kv"><span>Najdublji minus (u R)</span><b class="down">${fmtR(sel.mae)}</b></div>` : ""}</div></div>
      ${isFinite(sel.mfe) && isFinite(sel.mae) ? `<p class="note" style="margin-top:12px">Put cijene: ${op ? "do sada" : "do izlaza"} je najviše bila na ${fmtR(sel.mfe)} (T1 je na +2R), a najdublje na ${fmtR(sel.mae)} (stop je na −1R). Služi za procjenu jesu li stop i ciljevi dobro postavljeni.</p>` : ""}
      ${onChart ? "" : `<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="#/graf/${esc(sel.pair)}">Otvori na grafu uživo</a></div>`}</div>
      ${mid || ""}<div class="card mt"><h2>Na čemu se temelji signal</h2><div style="margin-top:10px">${pr.items.map(i => `<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><b>${esc(i.name)}</b><span class="muted">${i.v} / ${i.max}</span></div>
        <div class="bar"><div style="width:${i.max ? i.v / i.max * 100 : 0}%;background:${i.v / i.max >= .66 ? "var(--up)" : i.v / i.max >= .33 ? "var(--gray)" : "var(--down)"}"></div></div>${critHtml(i, sel)}</div>`).join("")}
        ${sigSummary(pr.items, sel)}
        ${pr.notes.length ? `<div class="kv" style="display:block;margin-top:6px">${pr.notes.map(n => `<div class="note">${esc(n)}</div>`).join("")}</div>` : ""}</div>
        <p class="note"><b>Poništenje:</b> cijena dotakne stop (${fmtP(sel.stop)}), provjera je svake minute, ili istek signala.</p>${isShort(sel) ? STOP_INFO.replace("razmak do zadnjeg 1h minimuma u 48 sati", "razmak do zadnjeg 1h maksimuma u 48 sati").replace("(prodaje se 50%)", "(pokriva se 50%)").replace("T2 = 3R (25%), T3 = 4R (25%)", "T2 = 3R (25%), T3 = 4R (25%); kod SHORT-a stop je iznad ulaza, a ciljevi ispod") : STOP_INFO}</div>`;
  }


/* ---- desktop: popis (tablica) i stranica detalja ---- */
const sPx = s => isOpen(s) ? (S.prices[s.pair] || NaN) : sigExitPrice(s);
const sR = s => isOpen(s) ? (isFinite(S.prices[s.pair]) ? (isShort(s) ? s.entry - S.prices[s.pair] : S.prices[s.pair] - s.entry) / Math.abs(s.entry - s.stop) : NaN) : s.rnet;
const gPos = r => isFinite(r) ? Math.max(0, Math.min(100, (r + 1.2) / 5.6 * 100)) : 21.4;
const rCls = r => !isFinite(r) ? "" : r <= -0.5 ? "down" : r >= 1.2 ? "up" : "";
const sAge = t => { const m = Math.max(0, Math.round((Date.now() - t) / 6e4)); return m < 60 ? "prije " + m + " min" : m < 1440 ? "prije " + Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : "prije " + Math.floor(m / 1440) + " d"; };
function sStat(s) {
  if (!isOpen(s)) return REASON_TXT[s.reason] || "Zatvoren";
  const px = sPx(s), r = sR(s), sh = isShort(s); if (!isFinite(px)) return "U igri";
  const hit = sh ? (px <= s.t3 ? "T3" : px <= s.t2 ? "T2" : px <= s.t1 ? "T1" : "") : (px >= s.t3 ? "T3" : px >= s.t2 ? "T2" : px >= s.t1 ? "T1" : "");
  if (sh ? px >= s.stop : px <= s.stop) return "Stop dotaknut, čeka potvrdu engine-a";
  return hit ? hit + " dosegnut" : r >= 1.4 ? "Blizu T1" : r <= -0.7 ? "Blizu stopa" : "U igri";
}
function gaugeH(s) {
  const op = isOpen(s), r = sR(s), ps = gPos(r), cl = rCls(r), lv = k => op ? `data-live="${esc(s.pair)}" data-k="${k}" data-sid="${esc(s.id)}"` : "";
  return `<div class="gauge"><u></u><u class="f ${cl}" style="left:${Math.min(ps, 21.4)}%;width:${Math.abs(ps - 21.4)}%" ${lv("gfl")}></u><i class="s" style="left:3.6%"></i><i class="e" style="left:21.4%"></i><i style="left:57.1%"></i><i style="left:75%"></i><i style="left:92.9%"></i><em class="${cl}" style="left:${ps}%" ${lv("gem")}></em></div>`;
}
function sigPage(sel, ids) {
  const pr = parseReasons(sel.reasons), op = isOpen(sel), sh = isShort(sel), r = sR(sel), cl = rCls(r), px = sPx(sel), real = sel.kind === "real";
  const i = ids.indexOf(sel.id), pv = ids[i - 1], nx = ids[i + 1], inJ = J().some(t => t.sig === sel.id);
  const lv = k => op ? `data-live="${esc(sel.pair)}" data-k="${k}" data-sid="${esc(sel.id)}"` : "";
  const mark = (left, c, t, v) => `<div class="gl" style="left:${left}%"><b class="${c}">${t}</b><span>${v}</span></div>`;
  const sd = sh ? "SHORT" : "LONG", kd = isSR(sel) ? "Sjena S/R" : isShadow(sel) ? "Sjena" : "Pravi";
  const hitTxt = sel.hit.length ? sel.hit.map(h => h + " ✓").join(" · ") : "Čeka prvi cilj (T1)";
  const nav = `<div class="pgnav"><a class="btn" href="#/signali">← Natrag na popis</a><span class="muted">Signali / ${esc(dn(sel.pair))}</span><span style="flex:1"></span>${i >= 0 ? `<span class="muted">${i + 1} od ${ids.length}</span>` : ""}${pv ? `<a class="btn sq" href="#/signali/${esc(pv)}" title="Prethodni">‹</a>` : '<span class="btn sq off">‹</span>'}${nx ? `<a class="btn sq" href="#/signali/${esc(nx)}" title="Sljedeći">›</a>` : '<span class="btn sq off">›</span>'}</div>`;
  const hero = `<div class="card pghero"><div class="pgtop"><div><div class="pgt"><h2>${esc(dn(sel.pair))}</h2><span class="sr-tag ${sh ? "dn" : "up"}">${sd}</span><span class="sr-tag ${isShadow(sel) ? "sh" : "re"}">${kd}</span>${inJ ? '<span class="sr-tag jn">u dnevniku</span>' : ""}</div>
    <div class="sub">Okvir ${sel.tf} · otvoren ${fmtT(sel.created)} (${sAge(sel.created)}) · vrijedi do ${fmtT(sel.expires)} · strategija v1 · ${isShadow(sel) ? "probni signal, nije za ulazak · " : ""}status <b class="${cl}">${esc(sStat(sel))}</b></div></div>
    <div class="pgn"><div><i>Bodovi</i><b>${sel.score}<small> / 100</small></b></div><div><i>${op ? "Sada" : "Rezultat"}</i><b class="${cl}" ${lv("rr")}>${isFinite(r) ? fmtR(r) : "–"}</b>${real ? `<em class="muted" ${op ? lv("spl") : ""}>${op ? "" : jm(sigRes(sel))}</em>` : ""}</div></div></div>
    <div class="pgg"><div class="gauge big"><u></u><u class="f ${cl}" style="left:${Math.min(gPos(r), 21.4)}%;width:${Math.abs(gPos(r) - 21.4)}%" ${lv("gfl")}></u><i class="s" style="left:3.6%"></i><i class="e" style="left:21.4%"></i><i style="left:57.1%"></i><i style="left:75%"></i><i style="left:92.9%"></i><em class="${cl}" style="left:${gPos(r)}%" ${lv("gem")}></em></div>
    ${mark(3.6, "down", "Stop −1R", fmtP(sel.stop_cur || sel.stop))}${mark(21.4, "", "Ulaz", fmtP(sel.entry))}${mark(57.1, "up", "T1 +2R · 50%", fmtP(sel.t1))}${mark(75, "up", "T2 +3R · 25%", fmtP(sel.t2))}${mark(92.9, "up", "T3 +4R · 25%", fmtP(sel.t3))}</div>
    <div class="pgbtn"><a class="btn primary" href="#/graf/${esc(sel.pair)}">Otvori na grafu uživo</a>${op && !inJ ? `<a class="btn" href="#/dnevnik/${esc(sel.id)}">Uđi u dnevnik</a>` : inJ ? '<span class="btn off">U dnevniku ✓</span>' : ""}<span style="flex:1"></span><span class="muted">Cijena ${op ? `<b data-live="${esc(sel.pair)}" data-k="price">${isFinite(px) ? fmtP(px) : "–"}</b>` : `<b>${isFinite(px) ? fmtP(px) : "–"}</b>`}</span></div></div>`;
  const left = `<div class="card"><h2>Na čemu se temelji signal</h2><div class="sub">${sel.score} / 100 bodova</div><div style="margin-top:10px">${pr.items.map(it => `<div style="margin:14px 0 18px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px"><b>${esc(it.name)}</b><span class="muted">${it.v} / ${it.max}</span></div>
    <div class="bar"><div style="width:${it.max ? it.v / it.max * 100 : 0}%;background:${it.v / it.max >= .66 ? "var(--up)" : it.v / it.max >= .33 ? "var(--gray)" : "var(--down)"}"></div></div>${critHtml(it, sel)}</div>`).join("")}
    ${sigSummary(pr.items, sel)}${pr.notes.length ? `<div class="kv" style="display:block;margin-top:6px">${pr.notes.map(n => `<div class="note">${esc(n)}</div>`).join("")}</div>` : ""}</div></div>`;
  const fact = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
  const right = `<div class="card"><h2>Činjenice</h2>${fact("Status", statusTag(sel))}${op ? "" : fact("Izlaz", (REASON_TXT[sel.reason] || "–") + " · " + fmtT(sel.exit))}${fact("Ciljevi", hitTxt)}${fact("Rizik / pozicija", sel.risk ? fmtN(sel.risk) + " / " + fmtN(sel.pos, 0) + " USDT" : "bez pozicije (sjena)")}${isFinite(sel.mfe) && isFinite(sel.mae) ? fact("Najveći plus", `<span class="up">${fmtR(sel.mfe)}</span>`) + fact("Najdublji minus", `<span class="down">${fmtR(sel.mae)}</span>`) + `<p class="note">Put cijene služi za procjenu jesu li stop i ciljevi dobro postavljeni (T1 je na +2R, stop na −1R).</p>` : ""}</div>
    <div class="card mt"><h2>Zašto baš ovaj stop i ciljevi?</h2>${sh ? STOP_INFO.replace("razmak do zadnjeg 1h minimuma u 48 sati", "razmak do zadnjeg 1h maksimuma u 48 sati").replace("(prodaje se 50%)", "(pokriva se 50%)").replace("T2 = 3R (25%), T3 = 4R (25%)", "T2 = 3R (25%), T3 = 4R (25%); kod SHORT-a je stop iznad ulaza, a ciljevi ispod") : STOP_INFO}</div>
    <div class="card mt"><h2>Kada se signal poništava?</h2><p class="note" style="margin-top:8px">Cijena dotakne stop (${fmtP(sel.stop)}), provjera je svake minute, ili istek signala (${fmtT(sel.expires)}).</p></div>`;
  return nav + hero + `<div class="pgcols"><div>${left}</div><div>${right}</div></div>`;
}

function rezimOf(s) {
  const b = s.btc7; if (!isFinite(b)) return "";
  return b < -10 ? "jaki pad" : b < -4 ? "pad" : b < 4 ? "bez smjera" : b < 10 ? "rast" : "jaki rast";
}
function novaRezimi(all) {
  const cl = all.filter(isClosed), op = all.filter(isOpen), nm = ["jaki pad", "pad", "bez smjera", "rast", "jaki rast", ""];
  let rows = "";
  [["SHORT", true], ["LONG", false]].forEach(a => nm.forEach(r => {
    const o = op.filter(s => isShort(s) === a[1] && rezimOf(s) === r).length, c = cl.filter(s => isShort(s) === a[1] && rezimOf(s) === r), rs = c.map(s => s.rnet).filter(isFinite);
    if (!o && !rs.length) return;
    const sw = rs.filter(x => x > 0).reduce((x, y) => x + y, 0), sl = rs.filter(x => x <= 0).reduce((x, y) => x + y, 0), avg = rs.length ? (sw + sl) / rs.length : NaN;
    rows += "<tr><td>" + a[0] + "</td><td>" + (r || "nepoznat") + "</td><td class=\"r\">" + o + "</td><td class=\"r\">" + rs.length + "</td><td class=\"r\">" + (isFinite(avg) ? fmtR(avg) : "–") + "</td><td class=\"r\">" + (sl < 0 ? fmtN(sw / -sl, 2) : "–") + "</td></tr>";
  }));
  return '<div class="card"><h2>Po tržišnom režimu (BTC 7 dana)</h2><div class="sub">Za odluku o filteru: vidi se u kojem režimu SHORT i LONG stvarno rade. LONG se uključuje kao sjena tek kad BTC 7d pređe +4%.</div>' + (rows ? "<table><tr><th>Smjer</th><th>Režim</th><th class=\"r\">Otvoreno</th><th class=\"r\">Zatvoreno</th><th class=\"r\">Prosj. R</th><th class=\"r\">PF</th></tr>" + rows + "</table>" : '<div class="note">Još nema podataka.</div>') + "</div>";
}
function novaSummary(all0) {
  const all = all0.filter(isShort);
  const cl = all.filter(isClosed), op = all.filter(isOpen), rs = cl.map(s => s.rnet).filter(isFinite), n = rs.length;
  const win = rs.filter(x => x > 0), sw = win.reduce((a, b) => a + b, 0), sl = rs.filter(x => x <= 0).reduce((a, b) => a + b, 0), tot = sw + sl;
  const avg = n ? tot / n : NaN, r0 = avg * 2, pf = sl < 0 ? sw / -sl : NaN;
  const ok = (c, t) => '<span class="' + (c ? "up" : "") + '">' + t + '</span>';
  const kv = (a, b) => '<div class="kv"><span>' + a + '</span><b>' + b + '</b></div>';
  const c1 = n >= 100, c2 = isFinite(r0) && r0 > 0.1, c3 = isFinite(pf) && pf > 1.15;
  return '<div class="card">' + kv("Zatvorenih", n + " od 100 potrebnih") + kv("Otvorenih", op.length) + kv("Dobitnih", n ? Math.round(win.length / n * 100) + "%" : "–") + kv("Prosječni R (novi rizik)", isFinite(avg) ? fmtR(avg) : "–") + kv("Prosječni R u osnovnom riziku (×2)", isFinite(r0) ? fmtR(r0) : "–") + kv("Profit factor", isFinite(pf) ? fmtN(pf, 2) : "–") +
    '<div class="muted" style="margin-top:12px;font-size:12px;line-height:1.6"><b>Kriteriji uspjeha</b>: najmanje 100 zatvorenih ' + ok(c1, c1 ? "✓" : "(još nije)") + ' · prosječni R u osnovnom riziku iznad +0,10 ' + ok(c2, c2 ? "✓" : "(još ne)") + ' · profit factor iznad 1,15 ' + ok(c3, c3 ? "✓" : "(još ne)") + '. Stop je 2× širi nego kod običnih signala (najviše 8% od ulaza), T1 je +1R (50%, pa stop na ulaz), ostatak ide s trailing stopom. R je u novom (širem) riziku.</div></div>';
}
function trailInfo(sel) {
  const ru = Math.abs(sel.entry - sel.stop), d = ru * 0.75, t1 = (sel.hit || []).includes("T1"), sh = isShort(sel);
  const ex = sh ? sel.entry - 2 * ru : sel.entry + 2 * ru, exStop = sh ? ex + d : ex - d;
  const p = x => '<p class="note" style="margin-top:8px;line-height:1.55">' + x + '</p>';
  return '<div class="card mt"><h2>Kako radi izlaz (trailing)</h2>' +
    p('<b>1. Prije T1:</b> cijela pozicija je u igri, crvena crta na grafu je stop (' + fmtP(sel.stop) + '). Ako je cijena dotakne, gubitak je −1R.') +
    p('<b>2. Kad cijena stigne do T1</b> (zelena crta, ' + fmtP(sel.t1) + '): zatvara se 50% pozicije s dobitkom +1R, a stop se za ostatak pomiče na ulaz (' + fmtP(sel.entry) + '). Tada trejd više ne može završiti u minusu.') +
    p('<b>3. Ostatak (50%) ide s trailing stopom</b>: to je pomični stop (plava crta na grafu, pojavi se nakon T1). Drži se na stalnom razmaku od ' + fmtP(d) + ' (' + fmtN(d / sel.entry * 100, 2) + '% od ulaza) od najboljeg dosega cijene i ' + (sh ? "samo se spušta, nikad ne vraća gore" : "samo se podiže, nikad ne vraća dolje") + '. Što cijena ode dalje u našu korist, to je stop bliže uz nju i zaključuje veći dobitak. Izlaz je kad cijena obrne do plave crte, ili kad signal istekne.') +
    p('<b>Primjer:</b> ako cijena nakon T1 ode do ' + fmtP(ex) + ', plava crta bude na ' + fmtP(exStop) + ', pa bi ostatak izašao ondje i zaključio oko ' + fmtN(2 - 0.75, 2) + 'R na tom dijelu (u novom riziku).') +
    (t1 ? p('<b>Sada:</b> T1 je već dosegnut, trailing stop je trenutno na ' + (isFinite(sel.stopCur) ? fmtP(sel.stopCur) : "–") + '.') : p('<b>Sada:</b> čeka se T1, trailing još nije aktivan.')) + '</div>';
}

function sigDetailV2(sel, onChart, mid) {
  const pr = parseReasons(sel.reasons), op = isOpen(sel), t1 = (sel.hit || []).includes("T1");
  const lv = (lab, v, c, k) => '<div class="kv"><span>' + lab + '</span><span style="display:flex;gap:14px"><b class="' + (c || "") + '">' + (v === "" ? "–" : fmtP(v)) + '</b>' + (op && k ? '<span class="muted" style="min-width:64px;text-align:right" data-live="' + sel.pair + '" data-k="' + k + '" data-sid="' + esc(sel.id) + '"></span>' : "") + '</span></div>';
  const bars = pr.items.map(i => '<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><b>' + esc(i.name) + '</b><span class="muted">' + i.v + ' / ' + i.max + '</span></div><div class="bar"><div style="width:' + (i.max ? i.v / i.max * 100 : 0) + '%;background:' + (i.v / i.max >= .66 ? "var(--up)" : i.v / i.max >= .33 ? "var(--gray)" : "var(--down)") + '"></div></div></div>').join("");
  return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap"><div><h2 style="font-size:22px;font-weight:600">' + esc(dn(sel.pair)) + ' · NOVA STRATEGIJA · ' + (isShort(sel) ? 'SHORT' : 'LONG') + ' · režim: ' + (rezimOf(sel) || '?') + '</h2>' +
    '<div class="sub" style="margin-top:4px">Probni signal (sjena, nije za ulazak) · okvir ' + sel.tf + ' · otvoren ' + fmtT(sel.created) + ' · vrijedi do ' + fmtT(sel.expires) + ' · strategija v2</div></div><div style="text-align:right"><div class="score"><b>' + sel.score + '</b><span class="muted">/ 100</span></div></div></div>' +
    '<div class="mt">' + lv("Ulaz", sel.entry, "", "") + lv("Stop (" + fmtPct((sel.stop / sel.entry - 1) * 100) + ")", sel.stop, "down", "st") + lv("T1 · +1R · 50%, pa stop na ulaz", sel.t1, "up", "t1") + lv("Ostatak 50% · trailing stop", t1 ? (sel.stopCur || "") : "", "", "") +
    '<div class="kv"><span>Status</span><span>' + statusTag(sel) + '</span></div>' + (op ? '<div class="kv"><span>Uživo (R)</span><b data-live="' + sel.pair + '" data-k="r" data-sid="' + esc(sel.id) + '">–</b></div>' : '<div class="kv"><span>Izlaz</span><b>' + (REASON_TXT[sel.reason] || "–") + ' · ' + fmtT(sel.exit) + ' · ' + fmtR(sel.rnet) + '</b></div>') +
    '<div class="kv"><span>Ciljevi</span><b>' + ((sel.hit || []).length ? sel.hit.map(h => h + " ✓").join(" · ") : "Čeka T1") + '</b></div>' + (isFinite(sel.mfe) && isFinite(sel.mae) ? '<div class="kv"><span>Najveći plus / minus (R)</span><b>' + fmtR(sel.mfe) + ' / ' + fmtR(sel.mae) + '</b></div>' : "") + '</div></div>' +
    (mid || "") + trailInfo(sel) + '<div class="card mt"><h2>Na čemu se temelji signal</h2><div style="margin-top:10px">' + bars + '</div><p class="note"><b>Poništenje:</b> cijena dotakne stop (' + fmtP(sel.stop) + ') ili istek signala.</p></div>';
}

function vSignali(arg) { const h = vSignali0(arg); return NOVA ? h.split("#/signali").join("#/nova") : h; }
function vSignali0(arg) {
  const all = (NOVA ? S.rows.filter(s => isV2(s) && !(s.stopPct > NOVA_MAX)) : realRows()).sort((a, b) => b.created - a.created);
  if (!["svi", "pravi", "sjene"].includes(sigFilter.f)) sigFilter.f = "svi";
  if (!["sve", "danas", "jucer", "24h", "7d"].includes(sigFilter.d)) sigFilter.d = "sve";
  if (!["bodovi", "novi", "stari", "t1", "stop"].includes(sigFilter.o)) sigFilter.o = "bodovi";
  const dayStart = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - off * 864e5; };
  const inDay = (t) => sigFilter.d === "sve" || (sigFilter.d === "danas" && t >= dayStart(0)) || (sigFilter.d === "jucer" && t >= dayStart(1) && t < dayStart(0)) || (sigFilter.d === "24h" && t >= Date.now() - 864e5) || (sigFilter.d === "7d" && t >= Date.now() - 7 * 864e5);
  if (!["otvoreni", "zatvoreni", "svi"].includes(sigFilter.s)) sigFilter.s = "otvoreni";
  const pxNow = s => S.prices[s.pair] || NaN;
  const rNow = s => { const p = pxNow(s); const r = isFinite(p) ? (isShort(s) ? s.entry - p : p - s.entry) / Math.abs(s.entry - s.stop) : NaN; return isV2(s) && (s.hit || []).includes("T1") && isFinite(r) ? (isFinite(s.grossR) ? s.grossR : 0.5) + (isFinite(s.remaining) ? s.remaining : 0.5) * r : r; };
  const ord = { bodovi: (a, b) => (b.score - a.score) || (b.created - a.created), novi: (a, b) => b.created - a.created, stari: (a, b) => a.created - b.created,
    t1: (a, b) => (isFinite(rNow(b)) ? rNow(b) : -9) - (isFinite(rNow(a)) ? rNow(a) : -9), stop: (a, b) => (isFinite(rNow(a)) ? rNow(a) : 9) - (isFinite(rNow(b)) ? rNow(b) : 9) }[sigFilter.o] || ((a, b) => b.score - a.score);
  const sSt = isNarrow() ? sigFilter.s : "otvoreni";
  const rows = all.filter(s => sSt === "svi" || (sSt === "otvoreni" ? isOpen(s) : !isOpen(s))).filter(s => inDay(s.created)).sort(ord);
  const jIds = new Set(J().map(t => t.sig));
  const chip = (on, attr, t) => `<button class="chip-btn ${on ? "on" : ""}" ${attr}>${t}</button>`;
  const sigBar = () => {
    const act = [].concat(sigFilter.f !== "svi" ? [[sigFilter.f === "pravi" ? "Pravi" : "Sjene", 'data-f="svi"']] : [], sigFilter.sd !== "sve" ? [[sigFilter.sd === "long" ? "Long" : "Short", 'data-sd="sve"']] : [], sigFilter.tf !== "sve" ? [[sigFilter.tf, 'data-tf2="sve"']] : [], sigFilter.nj ? [["Nisu u dnevniku", 'data-nj="1"']] : [], sigFilter.d !== "sve" ? [[{ danas: "Danas", jucer: "Jučer", "24h": "24 h", "7d": "7 dana" }[sigFilter.d], 'data-d="sve"']] : []), nAct = act.length;
    const ordName = { bodovi: "bodovi", t1: "najbliže T1", stop: "najbliže stopu", novi: "najnoviji", stari: "najstariji" }[sigFilter.o] || "bodovi";
    const op = all.filter(isOpen), opR = op.filter(isReal), lg = op.filter(s => !isShort(s)).length, shn = op.length - lg, today = op.filter(s => s.created >= dayStart(0)).length;
    const sumR = opR.reduce((a, s) => a + (isFinite(rNow(s)) ? rNow(s) : 0), 0), b7 = op.find(s => isFinite(s.btc7));
    const sheetMk = () => sigFilter.sh ? `<div class="sheetbg" data-sh="0"></div><div class="sheet2"><div class="sh-h"><b>Filteri</b><button class="sh-clr" data-clr="1">Očisti sve</button></div>
      <h4>Vrsta</h4><div class="sfrow">${[["svi", "Svi"], ["pravi", "Pravi"], ["sjene", "Sjene"]].map(([k, t]) => chip(sigFilter.f === k, `data-f="${k}"`, `${t} (${cnt[k]})`)).join("")}</div>
      <h4>Smjer i okvir</h4><div class="sfrow">${[["long", "Long"], ["short", "Short"]].map(([k, t]) => chip(sigFilter.sd === k, `data-sd="${sigFilter.sd === k ? "sve" : k}"`, t)).join("")}${[["4h", "4h"], ["1h", "1h"]].map(([k, t]) => chip(sigFilter.tf === k, `data-tf2="${sigFilter.tf === k ? "sve" : k}"`, t)).join("")}${chip(sigFilter.nj, 'data-nj="1"', "Nisu u dnevniku")}</div>
      <h4>Stiglo</h4><div class="sfrow">${[["sve", "Sve"], ["danas", "Danas"], ["jucer", "Jučer"], ["24h", "24 h"], ["7d", "7 dana"]].map(([k, t]) => chip(sigFilter.d === k, `data-d="${k}"`, t)).join("")}</div>
      <h4>Poredak</h4><div class="sfrow">${[["bodovi", "Bodovi"], ["t1", "Najbliže T1"], ["stop", "Najbliže stopu"], ["novi", "Najnoviji"], ["stari", "Najstariji"]].map(([k, t]) => chip(sigFilter.o === k, `data-o="${k}"`, t)).join("")}</div>
      <button class="sh-go" data-sh="0">Prikaži ${fl.length} ${fl.length === 1 ? "signal" : "signala"}</button></div>` : "";
    return `<div class="sstrip"><div><i>Otvoreno</i><b>${op.length}</b><small>${opR.length} pravih</small></div><div><i>Long / Short</i><b>${lg} / ${shn}</b><small>otvoreni</small></div><div><i>Pravi sada</i><b class="${sumR >= 0 ? "up" : "down"}">${fmtR(sumR)}</b><small>otvoreno</small></div><div><i>Danas</i><b>${today}</b><small>novih</small></div></div>
    ${b7 ? `<div class="sbtc ${b7.btc7 <= -2 ? "down" : b7.btc7 >= 2 ? "up" : ""}"><b>BTC 7 dana ${fmtPct(b7.btc7)}</b><span>${b7.btc7 <= -2 ? "tržište pada · shortovi su u prednosti" : b7.btc7 >= 2 ? "tržište raste · longovi su u prednosti" : "tržište bez jasnog smjera"}</span></div>` : ""}
    <div id="sfilter"><div class="sseg">${[["otvoreni", "Otvoreni"], ["zatvoreni", "Zatvoreni"], ["svi", "Svi"]].map(([k, t]) => `<button class="${sigFilter.s === k ? "on" : ""}" data-s="${k}">${t}</button>`).join("")}</div>
    <div class="sqrow"><input class="txt" id="sq" placeholder="Traži par…" value="${esc(sigFilter.q)}"><button class="fbtn" data-sh="1">⚙ Filteri${nAct ? `<span class="fbd">${nAct}</span>` : ""}</button></div>
    ${nAct ? `<div class="sact">${act.map(([t, at]) => `<button class="chip-btn on" ${at}>${t} ✕</button>`).join("")}</div>` : ""}
    <div class="sord muted">${rows.length} ${rows.length === 1 ? "signal" : "signala"} · poredak: ${ordName}</div>
    ${(window.__sheetHtml = sheetMk(), "")}</div>`;
  };
  const cnt = { svi: rows.length, pravi: rows.filter(isReal).length, sjene: rows.filter(isShadow).length };
  const fl = rows.filter(s => (sigFilter.f === "svi" || (sigFilter.f === "pravi" && isReal(s)) || (sigFilter.f === "sjene" && isShadow(s))) && (!isNarrow() || ((sigFilter.sd === "sve" || (sigFilter.sd === "short") === isShort(s)) && (sigFilter.tf === "sve" || s.tf === sigFilter.tf) && (!sigFilter.nj || !jIds.has(s.id)))) && (!sigFilter.q || s.pair.includes(sigFilter.q.toUpperCase())));
  const sel = all.find(s => s.id === arg) || fl[0] || rows[0];
  const sigBarD = () => `<div id="sfilter"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[["svi", "Svi"], ["pravi", "Pravi"], ["sjene", "Sjene"]].map(([k, t]) => `<button class="chip-btn ${sigFilter.f === k ? "on" : ""}" data-f="${k}">${t} (${cnt[k]})</button>`).join("")}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center"><span class="muted" style="font-size:12px">Stiglo:</span>${[["sve", "Sve"], ["danas", "Danas"], ["jucer", "Jučer"], ["24h", "24 h"], ["7d", "7 dana"]].map(([k, t]) => `<button class="chip-btn ${sigFilter.d === k ? "on" : ""}" data-d="${k}">${t}</button>`).join("")}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center"><span class="muted" style="font-size:12px">Poredak:</span>${[["bodovi", "Po bodovima"], ["novi", "Najnoviji"], ["stari", "Najstariji"]].map(([k, t]) => `<button class="chip-btn ${sigFilter.o === k ? "on" : ""}" data-o="${k}">${t}</button>`).join("")}</div></div>`;
  const listD = fl.map(s => `<div class="item k-${isShadow(s) ? "shadow" : "real"} ${sel && s.id === sel.id ? "on" : ""}" data-go="#/signali/${esc(s.id)}"><span class="coin ${isShadow(s) ? "g" : ""}"><i>${esc(dn(base(s.pair)).slice(0, 2))}</i></span>
    <div class="t"><b>${esc(dn(s.pair))} · ${isSR(s) ? "SJENA · S/R" + (isShort(s) ? " · SHORT" : "") : isShadow(s) ? "SJENA" + (isShort(s) ? " · SHORT" : "") : "PRAVI · " + (isShort(s) ? "SHORT" : "LONG")}</b><span>${fmtT(s.created)} · ${s.tf}</span></div><span class="sbadge" title="Ocjena signala (od 100)"><b>${s.score}</b><small>bodova</small></span>${statusTag(s)}
    <div class="lv"><div class="live"><i>Cijena</i><b data-live="${esc(s.pair)}" data-k="price">${S.prices[s.pair] ? fmtP(S.prices[s.pair]) : "–"}</b><em data-live="${esc(s.pair)}" data-k="spp" data-sid="${esc(s.id)}"></em></div><div><i>Ulaz</i><b>${fmtP(s.entry)}</b></div><div><i>Stop</i><b class="down">${fmtP(s.stop_cur || s.stop)}</b></div><div><i>T1</i><b class="up">${fmtP(s.t1)}</b></div><div><i>T2</i><b class="up">${fmtP(s.t2)}</b></div><div><i>T3</i><b class="up">${fmtP(s.t3)}</b></div></div></div>`).join("") || '<div class="empty">Nema otvorenih signala za ovaj filtar. Zatvoreni su u <a href="#/arhiva">Arhivi</a>.</div>';
  const ageTxt = t => { const m = Math.max(0, Math.round((Date.now() - t) / 6e4)); return m < 60 ? "prije " + m + " min" : m < 1440 ? "prije " + Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : "prije " + Math.floor(m / 1440) + " d"; };
  const list = fl.map(s => {
    const op = isOpen(s), sh = isShort(s), px = op ? pxNow(s) : sigExitPrice(s), r = op ? rNow(s) : s.rnet;
    const pos = isFinite(r) ? Math.max(0, Math.min(100, (r + 1.2) / 5.6 * 100)) : 21.4, cl = !isFinite(r) ? "" : r <= -0.5 ? "down" : r >= 1.2 ? "up" : "", fl0 = Math.min(pos, 21.4), fw = Math.abs(pos - 21.4);
    const hitT = isFinite(px) ? (sh ? (px <= s.t3 ? "T3" : px <= s.t2 ? "T2" : px <= s.t1 ? "T1" : "") : (px >= s.t3 ? "T3" : px >= s.t2 ? "T2" : px >= s.t1 ? "T1" : "")) : "";
    const stopT = isFinite(px) && (sh ? px >= s.stop : px <= s.stop);
    const stat = !op ? (REASON_TXT[s.reason] || "Zatvoren") : stopT ? "Stop dotaknut, čeka potvrdu engine-a" : isV2(s) && (s.hit || []).includes("T1") ? "T1 dosegnut, trailing" : hitT ? hitT + " dosegnut" : isFinite(r) && r >= 1.4 ? "Blizu T1" : isFinite(r) && r <= -0.7 ? "Blizu stopa" : "U igri";
    const full = []; String(s.reasons || "").split("\n").forEach(l => { const m = l.match(/^- (.+?) \((\d+)\/(\d+)\)/); if (m) full.push({ n: m[1], v: +m[2], m: +m[3] }); });
    const inJ = jIds.has(s.id), ex = sigFilter.x === s.id, mk = (c, left) => `<i class="${c}" style="left:${left}%"></i>`, lbl = (c, t, v) => `<div><b class="${c}">${t}</b><span>${v}</span></div>`;
    return `<div class="srow k-${isShadow(s) ? "shadow" : "real"} ${cl}" data-x="${esc(s.id)}"><div class="sr-top"><b class="sr-pair">${esc(dn(s.pair))}</b><span class="sr-tag ${sh ? "dn" : "up"}">${sh ? "SHORT" : "LONG"}</span><span class="sr-tag ${isShadow(s) ? "sh" : "re"}">${isSR(s) ? "Sjena S/R" : isShadow(s) ? "Sjena" : "Pravi"}</span>${inJ ? '<span class="sr-tag jn">u dnevniku</span>' : ""}<span class="sr-sc">${s.score} b</span><b class="sr-r ${cl}">${isFinite(r) ? fmtR(r) : "–"}</b></div>
    <div class="sr-mid"><span>${s.tf} · ${ageTxt(s.created)}${isV2(s) ? " · režim: " + (rezimOf(s) || "?") : ""}</span><b class="${cl}">${esc(stat)}</b><span class="sr-px"><span data-live="${esc(s.pair)}" data-k="price">${isFinite(px) ? fmtP(px) : "–"}</span></span></div>
    <div class="gauge"><u></u><u class="f ${cl}" style="left:${fl0}%;width:${fw}%"></u>${mk("s", 3.6)}${mk("e", 21.4)}${isV2(s) ? mk("t", 39.3) : mk("t", 57.1) + mk("t", 75) + mk("t", 92.9)}<em class="${cl}" style="left:${pos}%"></em></div>
    ${ex ? `<div class="sr-det"><div class="sr-lv">${lbl("down", "Stop −1R", fmtP(s.stop_cur || s.stop))}${lbl("", "Ulaz", fmtP(s.entry))}${lbl("up", isV2(s) ? "T1 +1R" : "T1 +2R", fmtP(s.t1))}${isV2(s) ? "" : lbl("up", "T2 +3R", fmtP(s.t2)) + lbl("up", "T3 +4R", fmtP(s.t3))}</div>
    ${full.length ? `<div class="sr-rs">${full.map(i => `<div><div><span>${esc(i.n)}</span><b>${i.v}/${i.m}</b></div><div class="bar"><div style="width:${i.m ? i.v / i.m * 100 : 0}%;background:#f28a3a"></div></div></div>`).join("")}</div>` : ""}
    <div class="sr-btn"><a class="btn" href="#/signali/${esc(s.id)}">Graf i detalji</a>${op && !inJ ? `<a class="btn primary" href="#/dnevnik/${esc(s.id)}">Uđi u dnevnik</a>` : ""}</div></div>` : ""}</div>`; }).join("") || '<div class="empty">Nema signala za ovaj filtar.</div>';
  if (isNarrow()) {
    if (!arg || !all.find(s => s.id === arg)) return shell(NOVA ? "Nova strategija (SHORT v2)" : "Signali i analiza", NOVA ? "Probni rad, bez Telegrama. Dodirni signal za graf s ulazom, T1 i stopom." : "Dodirnite signal da vidite graf, brojeve i razloge.", (NOVA ? novaSummary(all) + novaRezimi(all) : "") + `<div class="legend"><span class="tag real">Pravi signal</span><span class="tag shadow">Sjena (probni)</span></div>
    ${sigBar()}
    <div class="list">${list}</div>`);
    const d = all.find(s => s.id === arg);
    const chartBlock = `<div class="card mt sgc"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h2 style="margin:0">Graf</h2><div class="seg" id="sgtf">${Object.keys(INTERVAL).map(k => `<button data-tf="${k}" class="${chartState.tf === k ? "on" : ""}">${k}</button>`).join("")}</div></div><div class="chartwrap sgwrap" id="sgchart"></div></div>`;
    return shell(dn(d.pair), "", `<div style="margin-bottom:12px"><a class="btn" href="#/signali" id="sgback">← Svi signali</a></div>` + (isOpen(d) ? "" : '<div class="note" style="margin:0 0 10px">Ovaj signal je zatvoren (samo pregled).</div>') + sigDetail(d, false, chartBlock));
  }
  const dsel = all.find(s => s.id === arg);
  if (dsel) return shell(dn(dsel.pair), "", sigPage(dsel, fl.map(x => x.id)));
  const op0 = all.filter(isOpen), opR0 = op0.filter(isReal), lg0 = op0.filter(s => !isShort(s)).length, sum0 = opR0.reduce((a, s) => a + (isFinite(rNow(s)) ? rNow(s) : 0), 0), b70 = op0.find(s => isFinite(s.btc7));
  const tile = (a, b, c, k) => `<div class="stile"><i>${a}</i><b class="${k || ""}">${b}</b>${c ? `<small>${c}</small>` : ""}</div>`;
  const tiles = `<div class="sstripE">${tile("Otvoreno", op0.length, opR0.length + " pravih")}${tile("Long / Short", lg0 + " / " + (op0.length - lg0))}${tile("Pravi sada", fmtR(sum0), "otvoreno", sum0 >= 0 ? "up" : "down")}${tile("Stiglo danas", op0.filter(s => s.created >= dayStart(0)).length)}${b70 ? `<div class="stile btc ${b70.btc7 <= -2 ? "down" : b70.btc7 >= 2 ? "up" : ""}"><i>BTC 7 dana ${fmtPct(b70.btc7)}</i><small>${b70.btc7 <= -2 ? "tržište pada · shortovi su u prednosti" : b70.btc7 >= 2 ? "tržište raste · longovi su u prednosti" : "tržište bez jasnog smjera"}</small></div>` : tile("BTC 7 dana", "–")}</div>`;
  const grp = arr => `<div class="sgrp">${arr.join("")}</div>`;
  const tools = `<div id="sfilter" class="stool"><div class="sfrow">${grp([chip(sigFilter.s === "otvoreni", 'data-s="otvoreni"', "Otvoreni"), chip(sigFilter.s === "zatvoreni", 'data-s="zatvoreni"', "Zatvoreni"), chip(sigFilter.s === "svi", 'data-s="svi"', "Svi")])}${grp([["svi", "Svi"], ["pravi", "Pravi"], ["sjene", "Sjene"]].map(([k, t]) => chip(sigFilter.f === k, `data-f="${k}"`, `${t} ${cnt[k]}`)))}${grp([["long", "Long"], ["short", "Short"]].map(([k, t]) => chip(sigFilter.sd === k, `data-sd="${sigFilter.sd === k ? "sve" : k}"`, t)))}${grp([["4h", "4h"], ["1h", "1h"]].map(([k, t]) => chip(sigFilter.tf === k, `data-tf2="${sigFilter.tf === k ? "sve" : k}"`, t)))}${chip(sigFilter.nj, 'data-nj="1"', "Nisu u dnevniku")}<span style="flex:1"></span><input class="txt" id="sq" placeholder="Traži par…" value="${esc(sigFilter.q)}" style="width:170px;margin:0"></div>
    <div class="sfrow"><span class="muted" style="font-size:12px">Stiglo:</span>${grp([["sve", "Sve"], ["danas", "Danas"], ["jucer", "Jučer"], ["24h", "24 h"], ["7d", "7 dana"]].map(([k, t]) => chip(sigFilter.d === k, `data-d="${k}"`, t)))}<span class="muted" style="font-size:12px;margin-left:10px">Poredak:</span>${grp([["bodovi", "Bodovi"], ["t1", "Najbliže T1"], ["stop", "Najbliže stopu"], ["novi", "Najnoviji"], ["stari", "Najstariji"]].map(([k, t]) => chip(sigFilter.o === k, `data-o="${k}"`, t)))}</div></div>`;
  const trow = s => { const op = isOpen(s), sh = isShort(s), r = sR(s), cl = rCls(r), px = sPx(s), lv = k => op ? `data-live="${esc(s.pair)}" data-k="${k}" data-sid="${esc(s.id)}"` : "";
    return `<div class="trow" data-go="#/signali/${esc(s.id)}"><b class="tp">${esc(dn(s.pair))}${jIds.has(s.id) ? " <small>dnevnik</small>" : ""}</b><span class="sr-tag ${sh ? "dn" : "up"}">${sh ? "SHORT" : "LONG"}</span><span class="tk ${isShadow(s) ? "sh" : "re"}">${isSR(s) ? "Sjena S/R" : isShadow(s) ? "Sjena" : "Pravi"}</span><b>${s.score}</b><span class="muted">${s.tf} · ${sAge(s.created)}</span><b class="${cl}">${esc(sStat(s))}</b>${gaugeH(s)}<span class="tpx" ${op ? `data-live="${esc(s.pair)}" data-k="price"` : ""}>${isFinite(px) ? fmtP(px) : "–"}</span><b class="trr ${cl}" ${lv("rr")}>${isFinite(r) ? fmtR(r) : "–"}</b></div>`; };
  return shell("Signali i analize", "", `${tiles}${tools}<div class="ttab"><div class="thead"><span>PAR</span><span>SMJER</span><span>VRSTA</span><span>BODOVI</span><span>STARIJE</span><span>STATUS</span><span>STOP · ULAZ · T1 · T2 · T3 (točka = cijena)</span><span style="text-align:right">CIJENA</span><span style="text-align:right">R</span></div>${fl.map(trow).join("") || '<div class="empty">Nema signala za ovaj filtar.</div>'}</div>`);
}

const novaF = { f: "otvoreni" };
function vNova() {
  const all = S.rows.filter(isV2).sort((a, b) => b.created - a.created), cl = all.filter(isClosed), op = all.filter(isOpen);
  const rs = cl.map(s => s.rnet).filter(isFinite), n = rs.length, win = rs.filter(x => x > 0), los = rs.filter(x => x <= 0);
  const sw = win.reduce((a, b) => a + b, 0), sl = los.reduce((a, b) => a + b, 0), tot = sw + sl;
  const avg = n ? tot / n : NaN, r0 = avg * 2, pf = sl < 0 ? sw / -sl : NaN;
  const ok = (c, t) => '<span class="' + (c ? "up" : "") + '">' + t + '</span>';
  const kv = (a, b) => '<div class="kv"><span>' + a + '</span><b>' + b + '</b></div>';
  const pick = novaF.f === "otvoreni" ? op : novaF.f === "zatvoreni" ? cl : all;
  const rows = pick.slice(0, 300).map(s => {
    const o = isOpen(s), px = S.prices[s.pair], ru = Math.abs(s.entry - s.stop), t1 = (s.hit || []).includes("T1");
    const rl = isFinite(px) ? (s.entry - px) / ru : NaN;
    const cur = o ? (t1 && isFinite(rl) ? (isFinite(s.grossR) ? s.grossR : 0) + (isFinite(s.remaining) ? s.remaining : 0.5) * rl : rl) : s.rnet;
    const stat = o ? (t1 ? "T1 dosegnut, trailing" : "U igri") : (REASON_TXT[s.reason] || "Zatvoren");
    const sp = isFinite(s.stopPct) ? (s.stopPct * 100).toFixed(1).replace(".", ",") + " %" : "–";
    return "<tr><td>" + coin(s.pair, true) + "</td><td class=\"r\">" + s.score + "</td><td class=\"r\">" + sp + "</td><td class=\"r\">" + fmtP(s.entry) + "</td><td class=\"r\">" + fmtP(s.stopCur || s.stop) + "</td><td class=\"r\">" + fmtP(s.t1) + "</td><td>" + esc(stat) + "<div class=\"muted\" style=\"font-size:12px\">" + (o ? sAge(s.created) : fmtT(s.exit)) + "</div></td><td class=\"r\"><b class=\"" + rCls(cur * 2) + "\">" + (isFinite(cur) ? fmtR(cur) : "–") + "</b></td></tr>";
  }).join("");
  const f = [["otvoreni", "Otvoreni (" + op.length + ")"], ["zatvoreni", "Zatvoreni (" + cl.length + ")"], ["svi", "Svi (" + all.length + ")"]];
  const c1 = n >= 100, c2 = isFinite(r0) && r0 > 0.1, c3 = isFinite(pf) && pf > 1.15;
  return shell("Nova strategija (SHORT v2)", "Probni rad: ne šalje se na Telegram i ne utječe na prave signale. Stop je 2× širi od osnovnog, T1 je na istoj cijeni (50%, pa stop na ulaz), ostatak ide s trailing stopom. R je u novom (širem) riziku.",
    '<div class="card">' + kv("Zatvorenih", n + " od 100 potrebnih") + kv("Otvorenih", op.length) + kv("Dobitnih", n ? Math.round(win.length / n * 100) + "%" : "–") + kv("Prosječni R (novi rizik)", isFinite(avg) ? fmtR(avg) : "–") + kv("Prosječni R preračunat u osnovni rizik", isFinite(r0) ? fmtR(r0) : "–") + kv("Zbroj R (novi rizik)", n ? fmtR(tot) : "–") + kv("Profit factor", isFinite(pf) ? fmtN(pf, 2) : "–") +
    '<div class="muted" style="margin-top:12px;font-size:12px;line-height:1.6"><b>Kriteriji uspjeha</b> (određeni unaprijed): najmanje 100 zatvorenih ' + ok(c1, c1 ? "✓" : "(još nije)") + ' · prosječni R u osnovnom riziku iznad +0,10 ' + ok(c2, c2 ? "✓" : "(još ne)") + ' · profit factor iznad 1,15 ' + ok(c3, c3 ? "✓" : "(još ne)") + '. Ako do 100 zatvorenih ne prođe, strategija se odbacuje.</div></div>' +
    '<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" id="nfilter">' + f.map(x => '<button class="chip-btn ' + (novaF.f === x[0] ? "on" : "") + '" data-f="' + x[0] + '">' + x[1] + '</button>').join("") + '</div>' +
    '<table><tr><th>Par</th><th class="r">Ocjena</th><th class="r">Stop %</th><th class="r">Ulaz</th><th class="r">Stop</th><th class="r">T1</th><th>Status</th><th class="r">R</th></tr>' + (rows || '<tr><td colspan="8" class="muted">Još nema signala. Nova strategija prati SHORT signale od ocjene 55.</td></tr>') + '</table></div>');
}

/* ---------------- Arhiva parova ---------------- */
const arch = { f: "svi", q: "" };
function vArhiva() {
  const by = {}; realRows().forEach(s => { const k = s.pair + "|" + (isSR(s) ? "x" : isShadow(s) ? "s" : "r"); (by[k] = by[k] || []).push(s); });
  let list = Object.entries(by).map(([key, ss]) => { const pair = key.split("|")[0]; ss.sort((a, b) => b.created - a.created); const cl = ss.filter(isClosed), tot = cl.reduce((a, s) => a + (s.rnet || 0), 0);
    const lvl = x => (x.hit || []).includes("T3") ? 3 : (x.hit || []).includes("T2") ? 2 : (x.hit || []).includes("T1") ? 1 : 0, lv = [1, 2, 3].map(k => cl.filter(x => lvl(x) === k).length);
    return { pair, ss, n: ss.length, lv, best: Math.max(0, ...cl.map(lvl)), open: ss.filter(isOpen).length, tot, last: ss[0], real: ss.filter(s => !isShadow(s)).length, sh: isShadow(ss[0]) }; });
  list = list.filter(p => (arch.f === "svi" || (arch.f === "pravi" && !p.sh) || (arch.f === "sjene" && p.sh) || (arch.f === "otvoreni" && p.open) || (arch.f === "dobitni" && p.tot > 0) || (arch.f === "gubitni" && p.tot < 0)) && (!arch.q || p.pair.includes(arch.q.toUpperCase())));
  list.sort((a, b) => b.last.created - a.last.created);
  return shell("Arhiva parova", "Svi parovi za koje je bilo signala, pravih i sjena (svaka vrsta u svom retku). Klik na par otvara graf.", `<div class="card">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center" id="afilter">${["svi", "pravi", "sjene", "otvoreni", "dobitni", "gubitni"].map(k => `<button class="chip-btn ${arch.f === k ? "on" : ""}" data-f="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}
    <input class="txt sm" id="aq" placeholder="Traži par" value="${esc(arch.q)}" style="margin-left:auto"></div>
    ${arch.f === "dobitni" || arch.f === "gubitni" ? `<div class="sub" style="margin:0 0 10px"><b>${list.length}</b> ${arch.f === "dobitni" ? "dobitnih" : "gubitnih"} parova${arch.f === "dobitni" ? ` · najbolji ishod: do T1 <b>${list.filter(p => p.best === 1).length}</b> · do T2 <b>${list.filter(p => p.best === 2).length}</b> · do T3 <b>${list.filter(p => p.best === 3).length}</b>` : ""}</div>` : ""}
    <table><tr><th class="r">#</th><th>Par</th><th class="r">Cijena uživo</th><th class="r">Signala</th><th class="r">Otvorenih</th><th>Zadnji signal</th><th>Dosegnuti ciljevi</th><th class="r">Zbroj R</th><th>Zadnji ishod</th></tr>
    ${list.map((p, i) => `<tr class="click" data-go="#/graf/${esc(p.pair)}" data-sig="${esc(p.last.id)}"><td class="r muted">${i + 1}</td><td>${coin(p.pair)} ${kindTag(p.last)}</td><td class="r"><span data-live="${p.pair}" data-k="price">${S.prices[p.pair] ? fmtP(S.prices[p.pair]) : "–"}</span></td><td class="r">${p.n}</td><td class="r">${p.open || "–"}</td><td class="muted">${fmtT(p.last.created)}</td><td>${p.lv.some(Boolean) ? [3, 2, 1].filter(k => p.lv[k - 1]).map(k => `<span class="tag win">T${k}${p.lv[k - 1] > 1 ? " ×" + p.lv[k - 1] : ""}</span>`).join(" ") : "<span class=\"muted\">–</span>"}</td>
    <td class="r ${cls(p.tot)}"><b>${p.ss.some(isClosed) ? fmtR(p.tot) : "–"}</b></td><td>${statusTag(p.last)}</td></tr>`).join("") || '<tr><td colspan="9" class="empty">Nema parova za taj filtar.</td></tr>'}</table></div>`);
}

/* ---------------- Statistika ---------------- */

/* ---------------- Analitika novca (Statistika signala i Moja statistika) ---------------- */
let moneyTab = "pravi", moneyAt = 0, moneyLast = "";
const MPAL = ["#F28A3A", "#6FD58F", "#6AA7FF", "#E8B04A", "#B58CFF", "#4FC3C7", "#E58AB8"];
function sigMoney(s) { const risk = s.risk > 0 ? s.risk : START_EQUITY * 0.01, pct = Math.abs(s.entry - s.stop) / s.entry, full = pct > 0 ? risk / pct : 0, pos = s.pos > 0 ? s.pos : full, k = full > 0 ? pos / full : 1; return { risk, pos, k }; }
function sigRes(s) { const m = sigMoney(s); return (s.kind === "real" && isFinite(s.pnl)) ? s.pnl : (isFinite(s.rnet) ? s.rnet * m.risk * m.k : 0); }
function sigOpenRes(s, p) { const m = sigMoney(s), rem = isFinite(s.remaining) ? s.remaining : 1, part = isFinite(s.grossR) ? s.grossR : 0, r1 = s.entry - s.stop, live = isFinite(p) && r1 !== 0 ? rem * (p - s.entry) / r1 : 0; return (part + live) * m.risk * m.k; }
function donutSvg(parts, ctr, sub) {
  const tot = parts.reduce((a, p) => a + p.v, 0); if (!(tot > 0)) return '<div class="muted" style="padding:36px 0;text-align:center">Nema podataka.</div>';
  const R = 42, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.map(p => { const len = p.v / tot * C, g = parts.length > 1 ? 1.5 : 0; const e = `<circle r="${R}" cx="60" cy="60" fill="none" style="stroke:${p.c}" stroke-width="18" stroke-dasharray="${Math.max(0.1, len - g)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"><title>${esc(p.l)}: ${fmtN(p.v)} USDT</title></circle>`; off += len; return e; }).join("");
  return `<svg viewBox="0 0 120 120" class="dnut">${segs}<text x="60" y="58" text-anchor="middle" class="dc">${ctr}</text><text x="60" y="73" text-anchor="middle" class="ds">${sub}</text></svg>`;
}
function groupParts(map, colors) {
  const a = Object.entries(map).map(([l, v]) => ({ l: dn(l), v })).filter(x => x.v > 0).sort((x, y) => y.v - x.v); let top = a.slice(0, 6); const rest = a.slice(6).reduce((t, x) => t + x.v, 0);
  top = top.map((x, i) => ({ ...x, c: colors ? colors[i % colors.length] : MPAL[i % MPAL.length] })); if (rest > 0) top.push({ l: "Ostalo", v: rest, c: "#8a7f74" }); return top;
}
function legendHtml(parts) { const t = parts.reduce((a, p) => a + p.v, 0); return parts.map(p => `<div class="lg"><i style="background:${p.c}"></i><span>${esc(p.l)}</span><b>${fmtN(p.v)}</b><em>${(p.v / t * 100).toFixed(0)}%</em></div>`).join(""); }
function mCard(title, cap, parts, ctr, sub) { return `<div class="card mc"><h3>${title}</h3><div class="note">${cap}</div><div class="dwrap">${donutSvg(parts, ctr, sub)}</div><div class="leg">${parts.length ? legendHtml(parts) : ""}</div></div>`; }
function moneyData(src) {
  const items = [];
  if (src === "sig") {
    const tab = moneyTab, pick = s => tab === "pravi" ? s.kind === "real" : tab === "sr" ? isSR(s) : (isShadow(s) && !isSR(s));
    realRows().filter(pick).filter(s => inRange(isClosed(s) ? s.exit : s.created)).forEach(s => { const m = sigMoney(s); items.push(isClosed(s) ? { pair: s.pair, inv: m.pos, closed: true, res: sigRes(s) } : { pair: s.pair, inv: m.pos, closed: false, res: sigOpenRes(s, S.prices[s.pair]), invOpen: m.pos * (isFinite(s.remaining) ? s.remaining : 1), live: S.prices[s.pair] != null }); });
  } else {
    J().filter(t => inRange(jOpen(t) ? t.t : lastExit(t))).forEach(t => { const c = jcalc(t, S.prices[t.pair]); items.push(jOpen(t) ? { pair: t.pair, inv: t.usdt, closed: false, res: c.total, invOpen: c.rem * t.p, live: S.prices[t.pair] != null } : { pair: t.pair, inv: t.usdt, closed: true, res: c.realized }); });
  }
  return items;
}
function moneyBlock(src) {
  const items = moneyData(src), cl = items.filter(x => x.closed), op = items.filter(x => !x.closed);
  const win = cl.filter(x => x.res > 0).reduce((a, x) => a + x.res, 0), loss = Math.abs(cl.filter(x => x.res < 0).reduce((a, x) => a + x.res, 0));
  const opRes = op.reduce((a, x) => a + x.res, 0), opInv = op.reduce((a, x) => a + x.invOpen, 0), invAll = items.reduce((a, x) => a + x.inv, 0), invCl = cl.reduce((a, x) => a + x.inv, 0), net = win - loss, total = net + opRes;
  const noLive = op.some(x => !x.live);
  const sig = src === "sig", full = dateF === "sve", startV = sig ? START_EQUITY : mojStart();
  const tabs = sig ? `<div class="mtabs">${[["pravi", "Pravi signali"], ["sjene", "Sjene"], ["sr", "S/R sjena"]].map(([k, t]) => `<button class="chip-btn ${moneyTab === k ? "on" : ""}" data-mt="${k}">${t}</button>`).join("")}</div>` : "";
  const intro = !sig ? `Samo tvoji trejdovi iz dnevnika, po tvojoj cijeni i nakon provizije. Fiktivni račun od ${fmtN(startV, 0)} USDT.`
    : moneyTab === "pravi" ? `Fiktivni račun od ${fmtN(START_EQUITY, 0)} USDT. Ovo nije tvoj stvarni novac, nego evidencija kako bi prošli signali. Pozicija se računa pravilom 1% rizika.`
    : `Sjene nemaju stvarnu poziciju. Ovdje je izračun kao da je ušao s istim pravilom (1% rizika od ${fmtN(START_EQUITY, 0)} USDT), samo radi usporedbe.`;
  const row = (l, v, c, sub) => `<div class="wf"><div><b>${l}</b><span>${sub}</span></div><strong class="${c}">${v}</strong></div>`;
  const wf = (full ? row("Početak", fmtN(startV) + " USDT", "", sig ? "iznos s kojim je fiktivni račun krenuo" : "fiktivni početni račun (mijenja se u Moj pregled)") : "")
    + row("+ Dobiveno", (win > 0 ? "+" : "") + fmtN(win) + " USDT", "up", sig ? "zarada zatvorenih signala koji su završili u plusu" : "zarada zatvorenih trejdova u plusu, nakon provizije")
    + row("− Izgubljeno", (loss > 0 ? "−" : "") + fmtN(loss) + " USDT", "down", sig ? "gubitak zatvorenih signala koji su završili u minusu" : "gubitak zatvorenih trejdova u minusu")
    + row("+ Otvorene pozicije", jm(opRes) + " USDT", cls(opRes), "trenutni plus ili minus pozicija koje još traju");
  const eqLab = sig ? (full ? (moneyTab === "pravi" ? "= Stanje računa" : "= Zamišljeno stanje računa") : "= Rezultat u razdoblju") : (full ? "= Stanje računa" : "= Rezultat u razdoblju"), eqVal = full ? fmtN(startV + total) + " USDT" : jm(total) + " USDT";
  const eqCls = cls(total);
  const ratioParts = [{ l: "Dobiveno", v: win, c: "var(--up)" }, { l: "Izgubljeno", v: loss, c: "var(--down)" }].filter(x => x.v > 0);
  const byInv = {}; items.forEach(x => { byInv[x.pair] = (byInv[x.pair] || 0) + x.inv; });
  const netP = {}; cl.forEach(x => { netP[x.pair] = (netP[x.pair] || 0) + x.res; });
  const plusM = {}, minM = {}; Object.entries(netP).forEach(([k, v]) => { if (v > 0) plusM[k] = v; else if (v < 0) minM[k] = -v; });
  const plusS = Object.values(plusM).reduce((a, v) => a + v, 0), minS = Object.values(minM).reduce((a, v) => a + v, 0);
  const gl = [["Uloženo", "iznos pozicije, koliko je USDT bilo uloženo" + (sig ? ". Veličina se računa pravilom 1% rizika." : ".")], ["Dobiveno i izgubljeno", "rezultat zatvorenog " + (sig ? "signala" : "trejda") + " nakon što je stigao do cilja ili stopa."], ["Otvorene pozicije", "trenutni plus ili minus pozicije koja još traje, računa se s cijenom uživo."], ["Parovi u plusu i minusu", "svaki par se razvrstava prema neto rezultatu svih svojih zatvorenih " + (sig ? "signala" : "trejdova") + ", pa je u plusu ili u minusu, nikad u oba."]];
  return moneyLast = `<div id="moneyblk" data-src="${src}"><div class="card mhead"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">Analitika novca</h2>${tabs}</div><div class="note" style="margin-top:8px">${intro}</div></div>
  <div class="mrow1"><div class="card"><h3>Kako je nastao rezultat</h3><div class="note">Uloženo svega: <b>${fmtN(invAll)} USDT</b> (zatvoreno i otvoreno)</div>${wf}<div class="wf tot"><div><b>${eqLab}</b></div><strong class="${eqCls}">${eqVal}</strong></div></div>
    <div class="card"><h3>Otvorene pozicije</h3><div class="kv"><span>Broj otvorenih</span><b>${op.length}</b></div><div class="kv"><span>Uloženo u njih</span><b>${fmtN(opInv)} USDT</b></div><div class="kv"><span>Trenutni rezultat</span><b class="${cls(opRes)}">${jm(opRes)} USDT</b></div><div class="kv"><span>Trenutni rezultat (%)</span><b class="${cls(opRes)}">${opInv > 0 ? fmtPct(opRes / opInv * 100) : "–"}</b></div>${noLive ? '<div class="note" style="margin-top:8px">Cijena uživo još se učitava, rezultat otvorenih može biti netočan.</div>' : '<div class="note" style="margin-top:8px">Računa se s cijenom uživo.</div>'}</div></div>
  <div class="mrow2">${mCard("Dobiveno i izgubljeno", "naspram uloženog u zatvorene: " + fmtN(invCl) + " USDT", ratioParts, invCl > 0 ? fmtPct(net / invCl * 100) : "–", "neto / uloženo")}${mCard("Gdje je novac uložen", "iznos pozicije po paru", groupParts(byInv), fmtN(invAll, 0), "USDT")}${mCard("Parovi u plusu", "neto po paru, zatvoreni " + (sig ? "signali" : "trejdovi"), groupParts(plusM, ["#6FD58F", "#4FB87A", "#2f8f5c", "#8fe0a8", "#5fc48a", "#3d9b6a", "#a8e6bf"]), "+" + fmtN(plusS, 1), "USDT")}${mCard("Parovi u minusu", "neto po paru, zatvoreni " + (sig ? "signali" : "trejdovi"), groupParts(minM, ["#FF7B70", "#E0594E", "#B8433A", "#ff9a90", "#d4685d", "#a04038", "#ffb3ab"]), "−" + fmtN(minS, 1), "USDT")}</div>
  <details class="card mgl"><summary>Pojmovi</summary>${gl.map(([a, b]) => `<div class="kv"><span><b>${a}</b></span><span style="text-align:right;max-width:70%">${b}</span></div>`).join("")}</details></div>`;
}
function moneyRefresh() { const mb = document.getElementById("moneyblk"); if (!mb || Date.now() - moneyAt < 5000) return; moneyAt = Date.now(); const prev = moneyLast, h = moneyBlock(mb.dataset.src); if (h === prev) return; const m = $("#main"), sc = m ? m.scrollTop : 0, dt = mb.querySelector("details"), op = dt && dt.open; mb.outerHTML = h; const nd = document.querySelector("#moneyblk details"); if (nd && op) nd.open = true; if (m) m.scrollTop = sc; }

function vStatSig() {
  const rows = realRows().filter(s => inRange(isClosed(s) ? s.exit : s.created)), real = rows.filter(s => s.kind === "real" && s.status === "closed"), sh = rows.filter(s => s.status === "shadow_closed" && !isSR(s)), srr = rows.filter(s => s.status === "shadow_closed" && isSR(s));
  const card = (t, rs, dd) => { const s = summarize(rs, "rnet"); if (!s) return `<div class="card"><h2>${t}</h2><div class="empty">Nema zatvorenih signala.</div></div>`;
    return `<div class="card"><h2>${t}</h2><div style="margin-top:8px"><div class="kv"><span>Zatvorenih</span><b>${s.n}</b></div><div class="kv"><span>Uspješnost</span><b>${s.win.toFixed(0)}%</b></div><div class="kv"><span>Prosječni R</span><b class="${cls(s.avg)}">${fmtR(s.avg)}</b></div>
      <div class="kv"><span>Zbroj R</span><b class="${cls(s.sum)}">${fmtR(s.sum)}</b></div><div class="kv"><span>Profit factor</span><b>${isFinite(s.pf) ? fmtN(s.pf) : "∞"}</b></div>${dd ? `<div class="kv"><span>Maksimalni pad računa</span><b>${fmtN(maxDD(rs, "pnl", START_EQUITY), 1)}%</b></div>` : ""}</div></div>`; };
  const bucket = (lo, hi) => { const f = rs => rs.filter(s => s.score >= lo && s.score < hi), a = summarize(f(real), "rnet"), b = summarize(f(sh), "rnet");
    const c = s => s ? `${s.n} · ${s.win.toFixed(0)}% · <b class="${cls(s.avg)}">${fmtR(s.avg)}</b>` : "<span class='muted'>–</span>";
    return `<tr><td>${lo}–${Math.min(hi - 1, 100)}</td><td>${c(a)}</td><td>${c(b)}</td></tr>`; };
  const byR = k => { const o = {}; rows.filter(isClosed).forEach(s => { const key = s[k]; (o[key] = o[key] || []).push(s); }); return o; };
  const tfr = byR("tf"), rsn = byR("reason");
  return shell("Statistika signala", "Što bi se dogodilo da se točno slušaju stop i ciljevi. Pravi signali i sjene, nakon troškova. Strategija se ne mijenja prije 4 tjedna ili 100 zatvorenih signala.", dateBar() + moneyBlock("sig") + `
  <div class="grid g3 mt">${card("Pravi signali", real, true)}${card("Sjene (bez obavijesti)", sh, false)}${card("S/R varijanta (sjena)", srr, false)}
  <div class="card"><h2>Napredak do pregleda</h2><div style="margin-top:12px"><div class="kv"><span>Zatvorenih pravih</span><b>${real.length} / 100</b></div><div class="bar" style="margin:8px 0 14px"><div style="width:${Math.min(100, real.length)}%;background:var(--red)"></div></div>
  <div class="kv"><span>Ukupno signala</span><b>${rows.length}</b></div><div class="kv"><span>Otvorenih</span><b>${rows.filter(isOpen).length}</b></div></div></div></div>
  <div class="grid g2 mt" style="grid-template-columns:1fr 1fr"><div class="card"><h2>Po ocjeni signala</h2><div class="sub">Broj · pogodaka · prosječni R. Pomaže pri odluci o pragu.</div>
    <table><tr><th>Ocjena</th><th>Pravi</th><th>Sjene</th></tr>${[[55, 60], [60, 65], [65, 70], [70, 80], [80, 101]].map(([a, b]) => bucket(a, b)).join("")}</table></div>
  <div class="card"><h2>Po razlogu izlaza i okviru</h2><div class="sub">Svi zatvoreni, pravi i sjene</div><table><tr><th>Razlog</th><th class="r">Broj</th><th class="r">Prosj. R</th></tr>
    ${Object.entries(rsn).map(([k, v]) => { const s = summarize(v, "rnet"); return `<tr><td>${REASON_TXT[k] || k}</td><td class="r">${s.n}</td><td class="r ${cls(s.avg)}">${fmtR(s.avg)}</td></tr>`; }).join("")}</table>
    <table style="margin-top:10px"><tr><th>Okvir</th><th class="r">Broj</th><th class="r">Prosj. R</th></tr>${Object.entries(tfr).map(([k, v]) => { const s = summarize(v, "rnet"); return `<tr><td>${k}</td><td class="r">${s.n}</td><td class="r ${cls(s.avg)}">${fmtR(s.avg)}</td></tr>`; }).join("")}</table></div></div>${statExtras(rows)}`);
}

function statExtras(rows) {
  const row = (lab, rs) => { const s = summarize(rs, "rnet"); return s ? `<tr><td>${lab}</td><td class="r">${s.n}</td><td class="r">${s.win.toFixed(0)}%</td><td class="r ${cls(s.avg)}">${fmtR(s.avg)}</td><td class="r ${cls(s.sum)}">${fmtR(s.sum)}</td></tr>` : `<tr><td>${lab}</td><td class="r muted" colspan="4">–</td></tr>`; };
  const cl = rows.filter(s => isClosed(s) && !isSR(s));
  const tbl = (title, sub, keys, fn) => `<div class="card"><h2>${title}</h2><div class="sub">${sub}</div><table><tr><th></th><th class="r">Broj</th><th class="r">Pogodaka</th><th class="r">Prosj. R</th><th class="r">Zbroj R</th></tr>${keys.map(k => row(k, cl.filter(s => fn(s) === k))).join("")}</table></div>`;
  const blk = s => { const h = new Date(s.created).getHours(); return ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"][Math.floor(h / 4)]; };
  const dayN = ["Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota"];
  const btc = s => !isFinite(s.btc7) ? "nepoznato (stariji signali)" : s.btc7 >= 2 ? "BTC raste (7d iznad +2%)" : s.btc7 <= -2 ? "BTC pada (7d ispod −2%)" : "BTC bez smjera";
  // usporedba osnovne strategije i S/R varijante na istim ulazima
  const base = {}; rows.filter(s => !isSR(s) && s.status !== "skipped_capital").forEach(s => { base[s.pair + "|" + s.created] = s; });
  const prs = rows.filter(isSR).map(x => ({ x, b: base[x.pair + "|" + x.created] })).filter(p => p.b);
  const done = prs.filter(p => isClosed(p.x) && isClosed(p.b));
  const avg = k => done.length ? done.reduce((t, p) => t + (p[k].rnet || 0), 0) / done.length : NaN;
  const better = done.filter(p => (p.x.rnet || 0) > (p.b.rnet || 0)).length;
  const cmp = `<div class="card mt"><h2>Osnovna strategija i S/R varijanta, isti ulazi</h2><div class="sub">Isti signal, drugačiji stop i ciljevi. Ovo je pravi test je li S/R bolji. ${done.length ? `Završenih parova: ${done.length}, S/R bolji u ${better}. Prosjek osnovne ${fmtR(avg("b"))}, S/R ${fmtR(avg("x"))}.` : "Još nema parova koji su oba zatvoreni."}</div>
    <table><tr><th>Par</th><th>Otvoren</th><th class="r">Osnovna</th><th class="r">S/R</th><th class="r">Razlika</th></tr>${prs.sort((p, q) => q.x.created - p.x.created).map(p => { const bo = isClosed(p.b), xo = isClosed(p.x), d = bo && xo ? (p.x.rnet || 0) - (p.b.rnet || 0) : NaN;
      return `<tr class="click" data-go="#/graf/${esc(p.x.pair)}" data-sig="${esc(p.x.id)}"><td>${coin(p.x.pair)}</td><td class="muted">${fmtT(p.x.created)}</td><td class="r ${bo ? cls(p.b.rnet) : "muted"}">${bo ? fmtR(p.b.rnet) : "otvoreno"}</td><td class="r ${xo ? cls(p.x.rnet) : "muted"}">${xo ? fmtR(p.x.rnet) : "otvoreno"}</td><td class="r ${cls(d)}">${isNaN(d) ? "–" : fmtR(d)}</td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Još nema S/R parova. Pojavljuju se uz svaki novi signal.</td></tr>'}</table></div>`;
  return cmp + `<div class="grid g2 mt" style="grid-template-columns:1fr 1fr">${tbl("Po dobu dana", "Prema lokalnom vremenu otvaranja signala (pravi i sjene, bez S/R).", ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"], blk)}${tbl("Po danu u tjednu", "Dan otvaranja signala.", ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"], s => dayN[new Date(s.created).getDay()])}</div>
  <div class="grid g2 mt" style="grid-template-columns:1fr 1fr">${tbl("Po smjeru Bitcoina", "BTC 7 dana u trenutku signala. Bilježi se tek od sada, pa starijih signala nema ovdje.", ["BTC raste (7d iznad +2%)", "BTC bez smjera", "BTC pada (7d ispod −2%)", "nepoznato (stariji signali)"], btc)}<div class="card"><h2>Kako čitati</h2><div class="note" style="line-height:1.55">Dok je zatvorenih signala malo (ispod 30 po retku), razlike su uglavnom slučajne. Ne mijenjaj strategiju na temelju jednog retka. Gledaj samo ponavljane obrasce kad bude barem 100 zatvorenih.</div></div></div>`;
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
  return shell("Moja statistika", "Računa se samo iz tvog dnevnika, od trenutka kad si ti označio izlaz, po tvojoj cijeni i nakon provizije.", dateBar() + moneyBlock("moj") + `
  <div class="grid g3 mt"><div class="card"><h2>Moji trejdovi</h2><div style="margin-top:8px">${kv("Zatvorenih", n)}${kv("Još otvorenih", op.length)}${kv("Uspješnost", n ? Math.round(wins.length / n * 100) + "%" : "–")}${kv("Profit factor", n ? (gl > 0 ? fmtN(gw / gl) : gw > 0 ? "∞" : "–") : "–")}</div></div>
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
    <div class="card"><h2>Mobitel</h2><div class="sub">Aplikacija radi i na mobitelu. Otvori ${PUBLIC_URL.replace("https://", "")} u pregledniku mobitela, pa je dodaj na početni zaslon.</div>
      <ol class="note" style="margin:10px 0 0 18px;line-height:1.6"><li><b>Android (Chrome):</b> izbornik ⋮ → Instaliraj aplikaciju.</li><li><b>iPhone (Safari):</b> gumb Podijeli → Dodaj na početni zaslon.</li><li>Za prijenos veze s GitHubom ne moraš tipkati token: klikni ispod, zalijepi poveznicu u Telegram (Spremljene poruke), otvori je na mobitelu i potom obriši poruku.</li></ol>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="scopylink">Kopiraj poveznicu za mobitel</button></div>
      <div class="note" style="margin-top:10px">Obavijesti o signalima na mobitelu stižu preko Telegrama (alarmi rade i kad je aplikacija zatvorena).</div></div>
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
  <div class="cl"><div class="chartwrap" id="gwrap"></div><div class="cside"><div class="card"><h2>Signali na ovom paru</h2><div class="sub">Klik na signal otvara cijelu analizu ispod grafa.</div><div id="gsigs" style="margin-top:8px"></div></div>
    <div class="card"><h2>Moje linije</h2><div class="sub">Klik na „+ Moja linija“, pa klik na graf. Ili upišite cijenu.</div><div style="display:flex;gap:8px;margin-top:10px"><input class="txt" id="gprice-in" placeholder="Cijena" inputmode="decimal"><button class="btn" id="gprice-add">Dodaj</button></div><div id="glines" style="margin-top:8px"></div></div></div></div>
  <div id="gdet" style="margin-top:16px">${chartSel() ? sigDetail(chartSel(), true) : ""}</div>`);
}
function chartSel() {
  const ss = S.rows.filter(s => s.pair === chartState.pair && s.status !== "skipped_capital" && NOVA === isV2(s)).sort((a, b) => b.created - a.created);
  return ss.find(s => s.id === chartState.sig) || ss[0] || null;
}
function chartSigs() {
  const pair = chartState.pair; let ss = S.rows.filter(s => s.pair === pair && s.status !== "skipped_capital" && NOVA === isV2(s));
  if (chartState.show === "real") ss = ss.filter(s => s.kind === "real"); if (chartState.show === "open") ss = ss.filter(isOpen);
  return ss.map(s => { const o = isOpen(s); let xp = null, lab = ""; if (!o) { xp = s.reason === "T3" ? s.t3 : s.reason === "stop" ? s.stop : s.reason === "stop_na_ulazu" ? s.entry : null;
      if (xp == null && chart) { const i = chart.idxOfTime(s.exit); const k = chart.c[Math.max(0, Math.min(chart.c.length - 1, Math.round(i)))]; xp = k ? k.c : s.entry; }
      lab = (REASON_TXT[s.reason] || "") + " " + fmtR(s.rnet); }
    return { id: s.id, open: o, start: s.created, end: o ? null : s.exit, entry: s.entry, stop: s.stop, t1: s.t1, t2: s.t2, t3: s.t3, rnet: s.rnet, exitPrice: xp, exitLabel: lab, kind: s.kind, short: isShort(s), v2: isV2(s), stopCur: s.stopCur, hit: (s.hit || []).join(",") }; });
}
function paintChartSide() {
  const sg = $("#gsigs"); if (!sg) return; const ss = S.rows.filter(s => s.pair === chartState.pair && s.status !== "skipped_capital" && !isV2(s)).sort((a, b) => b.created - a.created);
  const cur = chartSel();
  sg.innerHTML = ss.length ? ss.map(s => `<div class="kv" style="cursor:pointer;align-items:center;${cur && cur.id === s.id ? "background:rgba(255,255,255,.07);border-radius:8px;padding:4px 8px;margin:0 -8px" : ""}" data-pick="${esc(s.id)}"><span>${kindTag(s)} ${fmtT(s.created)} · ${s.score}</span>${statusTag(s)}</div>`).join("") : '<div class="note">Nema signala za ovaj par. Možete ga ipak pratiti i crtati svoje linije.</div>';
  sg.querySelectorAll("[data-pick]").forEach(el => el.addEventListener("click", () => { chartState.sig = el.dataset.pick; lsSet("chartState", chartState); const s = S.rows.find(x => x.id === chartState.sig), d = $("#gdet"); if (d && s) { d.innerHTML = sigDetail(s, true); paintLive(); paintChartSide(); d.scrollIntoView({ behavior: "smooth", block: "start" }); } }));
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
  main.querySelectorAll("[data-go]").forEach(e => e.addEventListener("click", () => { if (e.dataset.sig) { chartState.sig = e.dataset.sig; lsSet("chartState", chartState); } location.hash = e.dataset.go; }));
  if (currentView === "pregled" || currentView === "moj") main.querySelectorAll("#eqseg button").forEach(b => b.addEventListener("click", () => { eqRange = b.dataset.r; lsSet("eqRange", eqRange); render(); }));
  if (currentView !== "signali") { const sr = $("#sheetroot"); if (sr) sr.remove(); document.body.classList.remove("shopen"); }
  if (currentView === "signali") {
    let syncSheet;
    const fclick = b => b.addEventListener("click", () => { if (b.dataset.f) sigFilter.f = b.dataset.f; if (b.dataset.d) sigFilter.d = b.dataset.d; if (b.dataset.o) sigFilter.o = b.dataset.o; if (b.dataset.s) sigFilter.s = b.dataset.s; if (b.dataset.sd) sigFilter.sd = b.dataset.sd; if (b.dataset.tf2) sigFilter.tf = b.dataset.tf2; if (b.dataset.nj) sigFilter.nj = !sigFilter.nj; if (b.dataset.sh) sigFilter.sh = b.dataset.sh === "1"; if (b.dataset.clr) Object.assign(sigFilter, { f: "svi", d: "sve", sd: "sve", tf: "sve", nj: false }); if (b.closest("#sheetroot") && b.dataset.sh !== "0") { vSignali(); syncSheet(); return; } render(); });
    main.querySelectorAll("#sfilter button").forEach(fclick);
    syncSheet = () => { document.body.classList.toggle("shopen", !!window.__sheetHtml && isNarrow()); const root0 = $("#sheetroot"), hh = window.__sheetHtml || ""; if (!hh || !isNarrow()) { if (root0) root0.remove(); } else if (root0 && root0.dataset.h !== hh && (() => { const tmp = document.createElement("div"); tmp.innerHTML = hh; const nb = [...tmp.querySelectorAll("button")], ob = [...root0.querySelectorAll("button")]; if (nb.length !== ob.length) return false; ob.forEach((o, i) => { const n = nb[i]; if (o.className !== n.className) o.className = n.className; [...n.attributes].forEach(at => { if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value); }); if (o.innerHTML !== n.innerHTML) o.innerHTML = n.innerHTML; }); root0.dataset.h = hh; return true; })()) {
    } else if (!root0 || root0.dataset.h !== hh) { const old = root0 && root0.querySelector(".sheet2"), sc0 = old ? old.scrollTop : 0, root = root0 || document.body.appendChild(Object.assign(document.createElement("div"), { id: "sheetroot" })); root.dataset.h = hh; root.innerHTML = hh; const nb = root.querySelector(".sheet2"); if (nb) nb.scrollTop = sc0; root.querySelectorAll("button").forEach(fclick); root.querySelectorAll(".sheetbg").forEach(x => x.addEventListener("click", () => { sigFilter.sh = false; render(); })); } };
    syncSheet();
    main.querySelectorAll(".srow").forEach(r => r.addEventListener("click", e => { if (e.target.closest("a,button")) return; sigFilter.x = sigFilter.x === r.dataset.x ? "" : r.dataset.x; render(); }));
    const q = $("#sq"); if (q) q.addEventListener("input", () => { sigFilter.q = q.value; const pos = q.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(pos, pos); });
    if ($("#sgchart")) bindSigChart(arg);
  }
  if (currentView === "nova") main.querySelectorAll("#nfilter button").forEach(b => b.addEventListener("click", () => { novaF.f = b.dataset.f; render(); }));
  if (currentView === "arhiva") {
    main.querySelectorAll("#afilter button").forEach(b => b.addEventListener("click", () => { arch.f = b.dataset.f; render(); }));
    const q = $("#aq"); q.addEventListener("input", () => { arch.q = q.value; const pos = q.selectionStart; render(); const n = $("#aq"); n.focus(); n.setSelectionRange(pos, pos); });
  }
  if (currentView === "postavke") {
    $("#ssave").addEventListener("click", async () => {
      const t = $("#stoken").value.trim(); cfg = Object.assign(cfg, { repo: $("#srepo").value.trim(), branch: $("#sbranch").value.trim() || "main", refresh: +$("#sref").value || 60, demo: $("#sdemo").checked }); if (t) cfg.token = t; const wt = $("#swtoken").value.trim(); if (wt) cfg.wtoken = wt;
      lsSet("cfg", cfg); S.source = "x"; await refreshData(); toast(S.err ? S.err : cfg.demo || !cfg.token ? "Spremljeno. Prikazuju se primjer podataka." : "Povezano. Učitano signala: " + S.rows.length);
    });
    $("#scopylink").addEventListener("click", async () => { if (!cfg.token) { toast("Najprije spremi token."); return; } try { await navigator.clipboard.writeText(transferLink()); toast("Poveznica kopirana. Zalijepi je u Telegram i otvori na mobitelu."); } catch (e) { toast("Kopiranje nije uspjelo."); } });
    $("#snotif").addEventListener("click", async () => { try { const r = await Notification.requestPermission(); $("#snstate").textContent = "Stanje: " + ({ granted: "uključeno", denied: "blokirano", default: "nije uključeno" }[r]); if (r === "granted") new Notification("Kripto signali", { body: "Obavijesti su uključene.", icon: "favicon-256.png" }); } catch (e) { toast("Ovaj prozor ne podržava obavijesti."); } });
    $("#swclear").addEventListener("click", () => { cfg.wtoken = ""; lsSet("cfg", cfg); render(); toast("Token za dnevnik je obrisan."); });
    $("#sclear").addEventListener("click", () => { cfg.token = ""; lsSet("cfg", cfg); S.source = "x"; refreshData(); toast("Token je obrisan s ovog računala."); });
  }
  document.querySelectorAll("[data-eye]").forEach(b => b.addEventListener("click", () => { balHidden = !balHidden; render(); }));
  if (currentView === "moj") { const b = $("#setstart"); if (b) b.addEventListener("click", () => { const v = prompt("Koliko je USDT na tvom Binance računu za ove trejdove (početno stanje)?", mojStart()); if (v === null) return; const n = parseFloat(String(v).replace(",", ".")); lsSet("mojStart", isFinite(n) && n > 0 ? n : 0); lsSet("journalUpd", Date.now()); jPushSoon(); render(); }); }
  if (currentView === "sdnevnik") { main.querySelectorAll("#sfilter button").forEach(b => b.addEventListener("click", () => { sdFilter.f = b.dataset.f; render(); })); const q = $("#sq"); if (q) q.addEventListener("input", () => { sdFilter.q = q.value; const pos = q.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(pos, pos); }); }
  const dfb = $("#dfbar"); if (dfb) dfb.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { dateF = b.dataset.df; lsSet("dateF", dateF); render(); }));
  if (currentView === "dnevnik") bindDnevnik(arg);
  if (currentView === "graf") bindChart();
}
function bindSigChart(id) {
  const sel = S.rows.find(x => x.id === id); if (!sel) return;
  chartState.pair = sel.pair; chartState.sig = sel.id; chartState.show = "all"; lsSet("chartState", chartState);
  const wrap = $("#sgchart"); chart = new PriceChart(wrap, { ema: chartState.ema, vol: chartState.vol, rsi: false, macd: false }); chart.setTheme(document.documentElement.dataset.theme);
  chart.setLines(allLines()); loadKlines();
  $("#sgtf").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { chartState.tf = b.dataset.tf; lsSet("chartState", chartState); $("#sgtf").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); chart.setData([], chartState.tf); loadKlines(); }));
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
    const body = JSON.stringify({ updated: lsGet("journalUpd", 0), start: mojStart(), trades: J() });
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
    if (d.updated > lu || (!J().length && (d.trades || []).length)) { lsSet("journal", d.trades || []); lsSet("mojStart", d.start || 0); lsSet("journalUpd", d.updated); S.jsync = Date.now(); if (["moj", "dnevnik", "mojastat", "usporedba"].includes(currentView) && !jExit && !jEdit) render(); }
    else if (d.updated < lu && cfg.wtoken) jPush();
    else S.jsync = Date.now();
  } catch (e) {}
}
const jm = v => (isFinite(v) ? (v > 0 ? "+" : "") + fmtN(v, 2) : "–");
const jqty = t => t.usdt / t.p;
const jsold = t => t.exits.reduce((a, x) => a + x.q, 0);
const jOpen = t => jqty(t) - jsold(t) > jqty(t) * 1e-6;
function jcalc(t, live) {
  const q = jqty(t), sold = jsold(t), rem = Math.max(0, q - sold), fee = (t.fee || 0) / 100, feeIn = t.usdt * fee, sd = t.side === "SHORT" ? -1 : 1;
  const realized = t.exits.reduce((a, x) => a + x.q * (x.p - t.p) * sd - x.q * x.p * fee, 0) - feeIn * (sold / q);
  const unreal = rem > q * 1e-6 && isFinite(live) ? rem * (live - t.p) * sd - feeIn * (rem / q) - rem * live * fee : 0;
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
/* ---- plan izlaza: T1/T2/T3 + stop, izvrsava se automatski kad cijena dotakne razinu ---- */
const PLAN_KEYS = ["T1", "T2", "T3"];
function planHtml(pfx, plan, pre) {
  const dp = lsGet("jplan", [50, 25, 25]), by = k => (plan || []).find(x => x.k === k);
  const pv = { T1: pre && pre.t1, T2: pre && pre.t2, T3: pre && pre.t3, Stop: pre && pre.stop };
  const cell = (k, i) => { const x = by(k), dd = x && x.done, val = x ? x.p : pv[k], pc = x ? x.pct : dp[i];
    return `<div><label class="f">${k} cijena${dd > 0 ? " ✓ izvršeno" : ""}</label><input class="txt" id="${pfx}_p${i + 1}" inputmode="decimal" value="${val ? fmtRaw(val) : ""}" ${dd ? "disabled" : ""}></div><div><label class="f">${k} udio početne pozicije (%)</label><input class="txt" id="${pfx}_q${i + 1}" inputmode="decimal" value="${pc}" ${dd ? "disabled" : ""}></div>`; };
  const st = by("Stop");
  return `<h2 style="margin-top:14px;font-size:15px">Plan izlaza (automatski)</h2><div class="sub">Kad cijena dotakne razinu, aplikacija sama upiše izlaz s tim udjelom početne pozicije. Stop zatvara sve preostalo. Prazna cijena = bez te razine. Radi dok je aplikacija otvorena, a pri sljedećem otvaranju nadoknadi što je cijena dotaknula u međuvremenu.</div>
    <div class="jgrid pgrid">${PLAN_KEYS.map(cell).join("")}<div><label class="f">Stop cijena${st && st.done > 0 ? " ✓ izvršeno" : ""}</label><input class="txt" id="${pfx}_ps" inputmode="decimal" value="${st ? fmtRaw(st.p) : (pre && pre.stop ? fmtRaw(pre.stop) : "")}" ${st && st.done ? "disabled" : ""}></div></div>`;
}
function readPlan(pfx, old) {
  const num = id => parseFloat(String($("#" + id).value).replace(",", ".")), out = [];
  PLAN_KEYS.forEach((k, i) => { const o = (old || []).find(x => x.k === k); if (o && o.done) { out.push(o); return; } const p = num(pfx + "_p" + (i + 1)), q = num(pfx + "_q" + (i + 1)); if (p > 0 && q > 0) out.push({ k, p, pct: Math.min(100, q), done: 0 }); });
  const o = (old || []).find(x => x.k === "Stop"); if (o && o.done) out.push(o); else { const p = num(pfx + "_ps"); if (p > 0) out.push({ k: "Stop", p, pct: 100, stop: 1, done: 0 }); }
  return out;
}
function checkPlan(side, entry, plan) {
  const sh = side === "SHORT"; let sum = 0;
  for (const x of plan) { if (x.done) { if (!x.stop) sum += x.pct; continue; }
    if (x.stop) { if (sh ? !(x.p > entry) : !(x.p < entry)) return "Stop mora biti " + (sh ? "iznad" : "ispod") + " cijene ulaza."; }
    else { sum += x.pct; if (sh ? !(x.p < entry) : !(x.p > entry)) return x.k + " mora biti " + (sh ? "ispod" : "iznad") + " cijene ulaza."; } }
  return sum > 100.001 ? "Zbroj udjela po razinama je " + fmtN(sum, 0) + "%, a smije biti najviše 100%." : "";
}
let jAutoBusy = false;
async function jAuto() {
  if (jAutoBusy || cfg.demo) return; jAutoBusy = true;
  try {
    const todo = J().filter(t => t.plan && jOpen(t) && t.plan.some(x => !x.done)), kl = {};
    for (const t of todo) { let st = Math.max(t.chk || 0, t.t), ks = [];
      for (let n = 0; n < 4; n++) { const r = await fetch(`${BINANCE}/api/v3/klines?symbol=${t.pair}&interval=1m&startTime=${st}&limit=1000`); if (!r.ok) break; const d = await r.json(); if (!Array.isArray(d) || !d.length) break; ks = ks.concat(d); if (d.length < 1000) break; st = d[d.length - 1][0] + 60000; }
      kl[t.id] = ks; }
    const a = J(); let changed = false; const now = Date.now();
    for (const t of a) { const ks = kl[t.id]; if (!ks || !t.plan || !jOpen(t)) continue; const sh = t.side === "SHORT", orig = jqty(t);
      for (const k of ks) { if (!jOpen(t)) break; const hi = +k[2], lo = +k[3], et = k[0] + 59999;
        const stop = t.plan.find(x => x.stop && !x.done);
        if (stop && (sh ? hi >= stop.p : lo <= stop.p)) { const rem = jqty(t) - jsold(t); t.exits.push({ t: et, p: stop.p, q: rem, auto: "Stop" }); t.plan.forEach(x => { if (!x.done) x.done = x === stop ? et : -1; }); changed = true; notify(`Stop dotaknut: ${dn(t.pair)} zatvoren po ${fmtP(stop.p)}`); break; }
        for (const x of t.plan) { if (x.stop || x.done || !jOpen(t)) continue; if (sh ? lo <= x.p : hi >= x.p) { const rem = jqty(t) - jsold(t), q = Math.min(rem, orig * x.pct / 100); t.exits.push({ t: et, p: x.p, q, auto: x.k }); x.done = et; changed = true; notify(`${x.k} dosegnut: ${dn(t.pair)} izlaz ${fmtN(x.pct, 0)}% po ${fmtP(x.p)}`); } }
        if (!jOpen(t)) { t.plan.forEach(x => { if (!x.done) x.done = -1; }); changed = true; } }
      const closedEnds = ks.filter(k => k[6] < now); if (closedEnds.length) { const e = closedEnds[closedEnds.length - 1][6] + 1; if (e !== t.chk) { t.chk = e; changed = true; } } }
    if (changed) { saveJ(a); syncLive(); if (["moj", "dnevnik", "mojastat", "usporedba"].includes(currentView) && !jExit && !jEdit) render(); }
  } catch (e) {}
  jAutoBusy = false;
}
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
    <div><label class="f">Smjer</label><select class="txt" id="eside"><option value="LONG">Long</option><option value="SHORT" ${ed.side === "SHORT" ? "selected" : ""}>Short</option></select></div><div><label class="f">Vrijeme ulaza</label><input class="txt" id="et" type="datetime-local" value="${toLocal(ed.t)}"></div><div><label class="f">Provizija po strani (%)</label><input class="txt" id="ef" inputmode="decimal" value="${ed.fee}"></div></div>
    ${ed.exits.length || jOpen(ed) ? planHtml("el", ed.plan) : ""}
    ${ed.exits.length ? `<h2 style="margin-top:14px;font-size:15px">Izlazi</h2>${ed.exits.map((x, i) => `<div class="jgrid" style="align-items:end"><div><label class="f">Cijena izlaza ${i + 1}</label><input class="txt" data-xp="${i}" inputmode="decimal" value="${fmtRaw(x.p)}"></div><div><label class="f">Vrijeme izlaza</label><input class="txt" data-xt="${i}" type="datetime-local" value="${toLocal(x.t)}"></div><div><button class="btn sm" data-xdel="${i}">Obriši ovaj izlaz</button></div></div>`).join("")}` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" id="esave">Spremi izmjene</button><button class="btn" id="ecancel">Odustani</button></div></div></div>` : "";
  const exForm = ex ? `<div class="modal" id="xmodal"><div class="card mbox"><h2>Izlaz iz trejda · ${esc(ex.pair)}</h2><div class="sub">Preostalo ${fmtN(jcalc(ex, S.prices[ex.pair]).remPct, 0)}% pozicije. Za djelomičan izlaz upišite manji udio.</div>
    <div class="jgrid"><div><label class="f">${ex.side === "SHORT" ? "Cijena pokrivanja shorta (USDT)" : "Cijena izlaza (USDT)"}</label><input class="txt" id="xp" inputmode="decimal" value="${S.prices[ex.pair] ? fmtRaw(S.prices[ex.pair]) : ""}"></div>
    <div><label class="f">Udio preostale pozicije (%)</label><input class="txt" id="xs" inputmode="decimal" value="100"></div>
    <div><label class="f">Vrijeme izlaza</label><input class="txt" id="xt" type="datetime-local" value="${nowLocal()}"></div></div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" id="xsave">Spremi izlaz</button><button class="btn" id="xcancel">Odustani</button></div></div></div>` : "";
  const rowsH = a.map(t => { const c = jcalc(t, S.prices[t.pair]), op = jOpen(t), sg = S.rows.find(s => s.id === t.sig);
    return `<tr><td>${coin(t.pair)}${t.side === "SHORT" ? ' <span class="tag short">SHORT</span>' : ""}${t.plan && t.plan.length ? `<div class="muted" style="font-size:11px;margin-top:3px">${t.plan.map(x => `${x.k} ${fmtP(x.p)}${x.stop ? "" : " " + fmtN(x.pct, 0) + "%"}${x.done > 0 ? " ✓" : x.done < 0 ? " –" : ""}`).join(" · ")}</div>` : ""}</td><td>${sg ? kindTag(sg) : '<span class="muted">ručno</span>'}</td><td class="muted">${fmtT(t.t)}</td><td class="r">${fmtP(t.p)}</td><td class="r">${fmtN(t.usdt)}</td>
    <td class="r">${op ? `<b data-live="${t.pair}" data-k="price">${S.prices[t.pair] ? fmtP(S.prices[t.pair]) : "–"}</b>` : "–"}</td>
    <td class="r">${isNaN(c.avgExit) ? "–" : fmtP(c.avgExit)}${t.exits.length ? `<div class="muted" style="font-size:11px">${fmtT(t.exits[t.exits.length - 1].t)}</div>` : ""}</td>
    <td class="r">${op ? fmtN(c.remPct, 0) + "%" : "zatvoreno"}</td>
    <td class="r"><b class="${cls(c.total)}" ${op ? `data-live="${t.pair}" data-k="jpl" data-jid="${t.id}"` : ""}>${jm(c.total)}</b></td>
    <td class="r"><span class="${cls(c.pct)}" ${op ? `data-live="${t.pair}" data-k="jpp" data-jid="${t.id}"` : ""}>${fmtPct(c.pct)}</span></td>
    <td class="r" style="white-space:nowrap">${op ? `<button class="btn sm" data-jx="${t.id}">Izlaz</button> ` : ""}<button class="btn sm" data-jedit="${t.id}">Uredi</button> <button class="x" data-jdel="${t.id}" aria-label="Obriši">×</button></td></tr>`; }).join("");
  return shell("Moj dnevnik", "Vaši stvarni ulazi i izlazi s Binancea: kada ste ušli, po kojoj cijeni, koliko USDT i kada ste izašli. Zarada uključuje proviziju.", dateBar() + `
  <div class="card stat lift" style="margin-bottom:14px"><div class="sub" style="display:flex;justify-content:space-between;align-items:center"><span>Moj račun (fiktivno${balHidden ? "" : ", početak " + fmtN(mojStart(), 0) + " USDT"})</span>${eyeBtn()}</div><div class="v ${balHidden ? "" : cls(jTotals().total)}">${balHidden ? MASK : fmtN(mojStart() + jTotals().total)} <span style="font-size:14px">USDT</span></div><div class="sub">≈ ${balHidden ? MASK : eurTxt(mojStart() + jTotals().total)}</div><div class="sub">početni račun + sve zatvoreno i otvoreno iz dnevnika${balHidden ? "" : " (" + jm(jTotals().total) + " USDT)"}</div></div>
  <div class="grid g4"><div class="card stat lift"><div class="sub">Realizirano</div><div class="v ${cls(tt.realized)}">${jm(tt.realized)} <span style="font-size:14px">USDT</span></div><div class="sub">${tt.cl} zatvorenih trejdova${tt.cl ? ", " + Math.round(tt.win / tt.cl * 100) + "% dobitnih" : ""}</div></div>
    <div class="card stat lift"><div class="sub">Otvoreno uživo</div><div class="v ${cls(tt.unreal)}">${jm(tt.unreal)} <span style="font-size:14px">USDT</span></div><div class="sub">neostvareno</div></div>
    <div class="card stat lift"><div class="sub">Ukupno</div><div class="v ${cls(tt.total)}">${jm(tt.total)} <span style="font-size:14px">USDT</span></div><div class="sub">realizirano + otvoreno</div></div>
    <div class="card stat lift"><div class="sub">Trenutno uloženo</div><div class="v">${fmtN(tt.inv)} <span style="font-size:14px">USDT</span></div><div class="sub">${a.filter(jOpen).length} otvorenih pozicija</div></div></div>
  <div class="card mt"><h2>Novi ulaz</h2><div class="sub">Upišite što ste stvarno kupili (ili shortali) na Binanceu. Odaberite signal da se podaci sami popune.</div>
    <div class="jgrid"><div><label class="f">Signal (nije obavezno)</label><select class="txt" id="nsig"><option value="">Bez signala (ručni unos)</option>${sigs.map(s => `<option value="${esc(s.id)}" ${s.id === sigId ? "selected" : ""}>${esc(s.pair)} · pravi${isShort(s) ? " SHORT" : ""} · ${fmtT(s.created)}</option>`).join("")}</select></div>
    <div><label class="f">Smjer</label><select class="txt" id="nside"><option value="LONG">Long (kupnja)</option><option value="SHORT" ${isShort(pre) ? "selected" : ""}>Short (futures x1)</option></select></div>
    <div><label class="f">Par</label><input class="txt" id="npair" list="jpairs" value="${pre ? esc(dn(pre.pair)) : ""}" placeholder="npr. SOLUSDT"><datalist id="jpairs">${pairs.map(p => `<option value="${dn(p)}">`).join("")}</datalist></div>
    <div><label class="f">Cijena ulaza (USDT)</label><input class="txt" id="np" inputmode="decimal" value="${pre ? fmtRaw(pre.entry) : ""}"></div>
    <div><label class="f">Uloženo (USDT)</label><input class="txt" id="nu" inputmode="decimal" placeholder="npr. 100"></div>
    <div><label class="f">Vrijeme ulaza</label><input class="txt" id="nt" type="datetime-local" value="${nowLocal()}"></div>
    <div><label class="f">Provizija po strani (%)</label><input class="txt" id="nf" inputmode="decimal" value="${lsGet("jfee", 0.1)}"></div></div>
    ${planHtml("nl", null, pre)}
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn primary" id="nsave">Spremi ulaz</button><button class="btn" id="jcsv">Izvezi CSV (sigurnosna kopija)</button></div></div>
  ${exForm}${edForm}
  <div class="card mt"><h2>Moji trejdovi</h2><table><tr><th>Par</th><th>Signal</th><th>Ulaz</th><th class="r">Cijena ulaza</th><th class="r">USDT</th><th class="r">Uživo</th><th class="r">Izlaz</th><th class="r">Preostalo</th><th class="r">Zarada USDT</th><th class="r">%</th><th></th></tr>
    ${rowsH || '<tr><td colspan="11" class="empty">Još nema unesenih trejdova.</td></tr>'}</table>
    <p class="note">Dnevnik se sprema na ovom računalu (u aplikaciji). Povremeno izvezite CSV kao sigurnosnu kopiju.</p></div>`);
}
const MOJ_START_DEF = 2000;
const mojStart = () => { const v = +lsGet("mojStart", 0); return v > 0 ? v : MOJ_START_DEF; };
const fmtRaw = v => String(+(+v).toPrecision(8));
function bindDnevnik(arg) {
  const num = id => parseFloat(String($(id).value).replace(",", "."));
  const sg = $("#nsig"); sg.addEventListener("change", () => { const s = S.rows.find(x => x.id === sg.value); if (s) { $("#npair").value = dn(s.pair); $("#np").value = fmtRaw(s.entry); $("#nside").value = s.side; [s.t1, s.t2, s.t3].forEach((v, i) => { $("#nl_p" + (i + 1)).value = fmtRaw(v); }); $("#nl_ps").value = fmtRaw(s.stop); } });
  $("#nsave").addEventListener("click", () => {
    const raw = $("#npair").value.trim().toUpperCase(), pair = isLatin(raw) ? realSym(raw.replace(/[^A-Z0-9]/g, "")) : raw, p = num("#np"), u = num("#nu"), f = num("#nf"), t = new Date($("#nt").value).getTime();
    if (!pair || !(p > 0) || !(u > 0) || !isFinite(t)) { toast("Upišite par, cijenu, iznos u USDT i vrijeme ulaza."); return; }
    const side = $("#nside").value === "SHORT" ? "SHORT" : "LONG", plan = readPlan("nl", null), perr = checkPlan(side, p, plan); if (perr) { toast(perr); return; }
    const a = J(); a.push({ id: "j" + Date.now(), pair: pair.endsWith("USDT") ? pair : pair + "USDT", sig: sg.value, t, p, usdt: u, fee: isFinite(f) ? f : 0.1, side, exits: [], plan: plan.length ? plan : undefined }); saveJ(a); lsSet("jfee", isFinite(f) ? f : 0.1);
    if (plan.length) lsSet("jplan", PLAN_KEYS.map((k, i) => { const x = plan.find(y => y.k === k); return x ? x.pct : [50, 25, 25][i]; }));
    syncLive(); toast(plan.length ? "Ulaz spremljen. Plan izlaza se izvršava automatski." : "Ulaz spremljen."); jAuto(); if (arg) location.hash = "#/dnevnik"; else render();
  });
  $("#jcsv").addEventListener("click", () => {
    const rows = [["par", "smjer", "signal", "ulaz_vrijeme", "ulaz_cijena", "usdt", "provizija_pct", "izlazi(vrijeme:cijena:kolicina)"]].concat(J().map(t => [t.pair, t.side === "SHORT" ? "SHORT" : "LONG", t.sig, new Date(t.t).toISOString(), t.p, t.usdt, t.fee, t.exits.map(x => new Date(x.t).toISOString() + ":" + x.p + ":" + x.q).join("|")]));
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
      const oldQ = jqty(t); t.pair = pair.endsWith("USDT") ? pair : pair + "USDT"; t.p = p; t.usdt = u; t.t = tm; t.fee = isFinite(f) ? f : 0.1; t.side = $("#eside").value === "SHORT" ? "SHORT" : "LONG"; const newQ = jqty(t);
      document.querySelectorAll("[data-xp]").forEach(e => { const i = +e.dataset.xp, xp = parseFloat(String(e.value).replace(",", ".")), xt = new Date(document.querySelector('[data-xt="' + i + '"]').value).getTime(); if (xp > 0) t.exits[i].p = xp; if (isFinite(xt)) t.exits[i].t = xt; t.exits[i].q = t.exits[i].q * newQ / oldQ; });
      const plan = $("#el_p1") ? readPlan("el", t.plan) : t.plan, perr = plan ? checkPlan(t.side, t.p, plan) : ""; if (perr) { toast(perr); return; } if ($("#el_p1")) t.plan = plan.length ? plan : undefined;
      saveJ(a); jEdit = ""; syncLive(); toast("Izmjene spremljene."); jAuto(); render(); });
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
