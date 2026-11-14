/* Podaci: CSV iz GitHub repozitorija, demo podaci, pomocne funkcije */
const START_EQUITY = 2500;
const HOUR = 3600e3;
const FIELDS = ["id","version","kind","status","created_at","created_ms","pair","side","tf","score","entry","stop","t1","t2","t3","stop_pct","risk_usdt","pos_value","remaining","stop_cur","hit","gross_r","exit_time","exit_ms","exit_reason","r_net","pnl_usdt","expires_ms","last_ms","reasons"];

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).filter(r => r.length > 1).map(r => {
    const o = {}; head.forEach((h, i) => o[h] = r[i] ?? ""); return o;
  });
}

function normRow(r) {
  const f = x => (x === "" || x == null) ? NaN : parseFloat(x);
  return {
    id: r.id, kind: r.kind, side: String(r.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG", status: r.status, pair: r.pair, tf: r.tf, score: f(r.score),
    version: r.version || "", mfe: f(r.mfe_r), mae: f(r.mae_r), btc7: f(r.btc7), created: f(r.created_ms), entry: f(r.entry), stop: f(r.stop), t1: f(r.t1), t2: f(r.t2), t3: f(r.t3),
    stopCur: f(r.stop_cur), stopPct: f(r.stop_pct), risk: f(r.risk_usdt) || 0, pos: f(r.pos_value) || 0,
    remaining: f(r.remaining), hit: (r.hit || "").split(",").filter(Boolean),
    grossR: f(r.gross_r), exit: f(r.exit_ms), reason: r.exit_reason || "", rnet: f(r.r_net),
    pnl: f(r.pnl_usdt), expires: f(r.expires_ms), last: f(r.last_ms), reasons: r.reasons || "",
  };
}
const isShort = s => !!s && s.side === "SHORT";
const sdOf = s => isShort(s) ? -1 : 1;
const isOpen = s => s.status === "open" || s.status === "shadow_open";
const isClosed = s => s.status === "closed" || s.status === "shadow_closed";
const isReal = s => s.kind === "real" && (s.status === "open" || s.status === "closed");
const isShadow = s => s.kind === "shadow";
const isSR = s => /-sr$/.test(s.version || "");

async function loadRemote(cfg) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/data/signali.csv?ref=${encodeURIComponent(cfg.branch || "main")}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new Error("GitHub je odbio token (" + res.status + "). Provjerite token u Postavkama.");
  if (res.status === 404) throw new Error("Datoteka data/signali.csv nije pronađena (404). Provjerite repozitorij i granu u Postavkama, ili pričekajte prvo pokretanje engina.");
  if (!res.ok) throw new Error("GitHub greška " + res.status);
  return parseCSV(await res.text()).map(normRow);
}

/* zadnje pokretanje enginea = vrijeme zadnjeg commita na data/statistika.md */
async function loadEngineAge(cfg) {
  const url = `https://api.github.com/repos/${cfg.repo}/commits?path=data/statistika.md&per_page=1&sha=${encodeURIComponent(cfg.branch || "main")}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  if (!res.ok) throw new Error("commits " + res.status);
  const j = await res.json();
  return j && j[0] ? Date.parse(j[0].commit.committer.date) : 0;
}

/* ---------- demo podaci ---------- */
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const DEMO_FALLBACK = { DODOUSDT: 0.0274, INITUSDT: 0.078, ICPUSDT: 6.28, ONDOUSDT: 0.94, ARBUSDT: 0.41, SUIUSDT: 2.06, NEARUSDT: 3.18, ZROUSDT: 2.6, TIAUSDT: 1.9, OPUSDT: 0.9, INJUSDT: 11, SEIUSDT: 0.16 };
const DEMO_REASONS =
`- Trend dnevni (15/15): cijena iznad EMA50, EMA20 > EMA50 > EMA200
- Trend 4h (15/15): cijena iznad EMA50, EMA20 > EMA50 > EMA200
- 4h razine: cijena {P}, EMA20 {P}, EMA50 {P}, EMA200 {P}
- Momentum (13/15): RSI u zoni snage, MACD histogram raste iznad nule
- Vrijednosti: RSI 4h 64, RSI 1h 58, MACD histogram 4h +0.0003
- Volumen (10/20): OBV 4h iznad prosjeka, OBV 1h raste
- Volumen 1h: 1.0x prosjeka zadnjih 20 svijeca
- Struktura (0/15): nema proboja 20-svijecnog maksimuma
- Divergencije (10/10): skrivena bikovska divergencija (RSI, MACD) na 4h
- Fundamenti, zamjenski (10/10): volumen 24h iznad 7-dnevnog prosjeka, 7d prinos bolji od Bitcoina
Stop: ispod zadnjeg 1h swing minimuma`;

function demoRows(prices) {
  const now = Date.now(), R = rng(7), rows = [];
  const px = p => prices[p] || DEMO_FALLBACK[p] || 1;
  let equity = START_EQUITY;
  const pairs = Object.keys(DEMO_FALLBACK);
  function mk(i, pair, kind, ageH, score, outcome) {
    const base = px(pair), entry = base * (outcome === "open" ? 0.992 : (0.9 + R() * 0.2));
    const stopPct = 0.025 + R() * 0.035, stop = entry * (1 - stopPct), ru = entry - stop;
    const created = Math.floor((now - ageH * HOUR) / HOUR) * HOUR;
    const risk = kind === "real" ? equity * 0.01 : 0;
    const o = { id: `${created}-${pair}-${kind[0]}`, kind, pair, tf: R() < .5 ? "4h" : "1h", score, created,
      entry, stop, t1: entry + 2 * ru, t2: entry + 3 * ru, t3: entry + 4 * ru, stopCur: stop, stopPct,
      risk, pos: risk ? risk / ru * entry : 0, remaining: 1, hit: [], grossR: 0, exit: NaN, reason: "", rnet: NaN, pnl: NaN,
      expires: created + (R() < .5 ? 72 : 24) * HOUR, last: now, reasons: DEMO_REASONS.replace(/\{P\}/g, () => (entry * (0.97 + R() * .05)).toPrecision(5)) };
    const closeAt = created + (4 + R() * 40) * HOUR;
    if (outcome === "open") { o.status = kind === "real" ? "open" : "shadow_open"; o.hit = []; }
    else {
      const map = { T3: [2.69, ["T1","T2","T3"]], T1: [0.95, ["T1"]], stop: [-1.1, []], exp: [0.1, []] };
      const [rn, hit] = map[outcome];
      o.hit = hit; o.rnet = rn + (R() - .5) * .1; o.exit = Math.min(closeAt, now - HOUR);
      o.reason = { T3: "T3", T1: "stop_na_ulazu", stop: "stop", exp: "isteklo" }[outcome];
      o.remaining = 0; o.grossR = o.rnet + .02; o.status = kind === "real" ? "closed" : "shadow_closed";
      if (kind === "real") { o.pnl = o.rnet * risk; equity += o.pnl; }
    }
    return o;
  }
  const outs = ["T3","stop","T1","stop","T3","exp","T1","stop","T3","T1","stop","T1","T3","stop","exp","T1","stop","T1","T3","stop","T1","T1","stop","T3"];
  outs.forEach((out, i) => rows.push(mk(i, pairs[1 + (i % (pairs.length - 1))], "real", 700 - i * 27, 65 + Math.floor(R() * 14), out)));
  for (let i = 0; i < 12; i++) rows.push(mk(i, pairs[1 + (i * 5 % (pairs.length - 1))], "shadow", 600 - i * 41, 55 + Math.floor(R() * 9), ["T1","stop","stop","T3","exp","stop","T1","stop","T3","stop","exp","T1"][i]));
  rows.push(mk(99, "DODOUSDT", "real", 6, 73, "open"));
  rows.push(mk(98, "NEARUSDT", "shadow", 3, 58, "open"));
  rows.sort((a, b) => b.created - a.created);
  return rows;
}

async function loadDemo() {
  let prices = {};
  try {
    const r = await fetch("https://data-api.binance.vision/api/v3/ticker/price");
    if (r.ok) (await r.json()).forEach(x => { if (DEMO_FALLBACK[x.symbol]) prices[x.symbol] = parseFloat(x.price); });
  } catch (e) {}
  return demoRows(prices);
}

/* ---------- izracuni ---------- */
function equityOf(rows) { return START_EQUITY + rows.filter(s => s.kind === "real" && s.status === "closed").reduce((a, s) => a + (s.pnl || 0), 0); }
function summarize(rs, key) {
  const v = rs.map(s => s[key]).filter(x => !isNaN(x)); if (!v.length) return null;
  const w = v.filter(x => x > 0), l = v.filter(x => x < 0);
  const sum = v.reduce((a, b) => a + b, 0);
  return { n: v.length, win: 100 * w.length / v.length, avg: sum / v.length, sum,
    pf: l.length ? w.reduce((a, b) => a + b, 0) / Math.abs(l.reduce((a, b) => a + b, 0)) : (w.length ? Infinity : 0) };
}
function maxDD(rs, key, start) {
  let peak = start, eq = start, m = 0;
  [...rs].sort((a, b) => a.exit - b.exit).forEach(s => { eq += s[key] || 0; peak = Math.max(peak, eq); if (peak > 0) m = Math.max(m, (peak - eq) / peak); });
  return m * 100;
}
const REASON_TXT = { T3: "Cilj T3", stop_na_ulazu: "T1, pa ulaz", stop: "Stop", isteklo: "Istek" };

/* ---------- formatiranje ---------- */
function fmtP(p) {
  if (p == null || isNaN(p)) return "–";
  const a = Math.abs(p); const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : 6;
  return p.toLocaleString("hr-HR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtN(x, d = 2) { return isNaN(x) ? "–" : x.toLocaleString("hr-HR", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtR(x) { return isNaN(x) ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "R"; }
function fmtPct(x, d = 2) { return isNaN(x) ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("hr-HR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%"; }
const TZ = "Europe/Zagreb";
function fmtT(ms) {
  if (!ms || isNaN(ms)) return "–";
  const p = new Intl.DateTimeFormat("hr-HR", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  return `${g("day")}. ${g("month")}. ${g("hour")}:${g("minute")}`;
}
function fmtHM(ms) {
  return new Intl.DateTimeFormat("hr-HR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}
const base = pair => pair.replace(/USDT$/, "");
const cls = x => x > 0 ? "up" : x < 0 ? "down" : "";
