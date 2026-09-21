import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js?v=202609210020";

// Si config.js no está configurado, el panel arranca en MODO DEMO con datos de ejemplo.
const DEMO = SUPABASE_URL.includes("TU-PROYECTO");
const sb = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SETUPS = {
  vela_maestra: "Vela Maestra (apertura)",
  rebote_ema20: "Rebote EMA20",
  iman: "Imán (reversión a EMA20)",
  momentum: "Momentum",
  rompimiento_ema20: "Rompimiento EMA20",
};

const S = { user: null, profile: null, settings: null, trades: [], events: {}, signals: [], watch: [], tab: "panel", charts: [] };

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (n) => (n == null || isNaN(n) ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cls = (n) => (+n > 0 ? "pos" : +n < 0 ? "neg" : "");
const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const etTime = (iso) => new Date(iso).toLocaleTimeString("es", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
const today = () => etDay(new Date().toISOString());
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}
async function action(body) {
  if (DEMO) return toast("Modo demo: conecta Supabase en config.js para operar"), null;
  const { data, error } = await sb.functions.invoke("user-actions", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data;
}

// ---------- arranque ----------
async function boot() {
  if (DEMO) {
    Object.assign(S, demoData());
    return render();
  }
  // El enlace de "olvidé mi contraseña" llega con type=recovery en la URL.
  S.recovering = /type=recovery/.test(location.hash + location.search);
  let ready = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") S.recovering = true;
    const changed = (session?.user?.id ?? null) !== (S.user?.id ?? null);
    S.user = session?.user ?? null;
    if (!ready) return;
    if (S.recovering) return renderNewPassword();
    if (changed) start();
  });
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user ?? null;
  ready = true;
  if (S.recovering && S.user) return renderNewPassword();
  start();
}

async function start() {
  if (!S.user) return renderAuth();
  await loadAll();
  render();
  subscribe();
}

async function loadAll() {
  const uid = S.user.id;
  const [p, s, t, w, sig] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).single(),
    sb.from("bot_settings").select("*").eq("user_id", uid).single(),
    sb.from("trades").select("*").eq("user_id", uid).order("opened_at", { ascending: false }).limit(1000),
    sb.from("watchlist").select("*").eq("user_id", uid).order("symbol"),
    sb.from("signals").select("*").order("ts", { ascending: false }).limit(60),
  ]);
  S.profile = p.data;
  S.settings = s.data;
  S.trades = t.data ?? [];
  S.watch = w.data ?? [];
  S.signals = sig.data ?? [];
  const openIds = S.trades.filter((x) => x.status === "open").map((x) => x.id);
  if (openIds.length) await loadEvents(openIds);
}

async function loadEvents(ids) {
  if (DEMO) return;
  const { data } = await sb.from("trade_events").select("*").in("trade_id", ids).order("ts", { ascending: false }).limit(500);
  for (const id of ids) S.events[id] = [];
  for (const e of data ?? []) (S.events[e.trade_id] ??= []).push(e);
}

let channel;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  let pending;
  const refresh = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => { await loadAll(); render(); }, 600);
  };
  channel = sb.channel("live")
    .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: `user_id=eq.${S.user.id}` }, refresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "trade_events", filter: `user_id=eq.${S.user.id}` }, refresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, refresh)
    .subscribe();
}

// ---------- autenticación ----------
function renderAuth(mode = "login") {
  $("#app").innerHTML = `
  <div class="auth">
    <div class="brand" style="font-size:22px;text-align:center;margin-bottom:16px">True Trader<span>X</span></div>
    <div class="card">
      <h2>${mode === "login" ? "Entrar" : "Crear cuenta"}</h2>
      <form id="authForm" class="grid">
        ${mode === "signup" ? `<div><label>Nombre</label><input name="name" required></div>` : ""}
        <div><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
        <div><label>Contraseña</label><input name="password" type="password" minlength="8" required autocomplete="${mode === "login" ? "current-password" : "new-password"}"></div>
        <button class="btn primary">${mode === "login" ? "Entrar" : "Registrarme"}</button>
      </form>
      <p class="muted" style="margin-bottom:0">
        ${mode === "login" ? `¿No tienes cuenta? <a href="#" id="swap">Regístrate</a> · <a href="#" id="forgot">¿Olvidaste tu contraseña?</a>` : `¿Ya tienes cuenta? <a href="#" id="swap">Entrar</a>`}
      </p>
    </div>
  </div>`;
  $("#swap").onclick = (e) => { e.preventDefault(); renderAuth(mode === "login" ? "signup" : "login"); };
  $("#forgot")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = $("#authForm [name=email]").value.trim();
    if (!email) return toast("Escribe tu email arriba y vuelve a pulsar «¿Olvidaste tu contraseña?»", 5000);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast(error ? authError(error.message) : "Te enviamos un correo para crear una contraseña nueva (revisa también spam)", 8000);
  });
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const r = mode === "login"
      ? await sb.auth.signInWithPassword({ email: f.email, password: f.password })
      : await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { full_name: f.name } } });
    if (r.error) return toast(authError(r.error.message), 7000);
    if (mode === "signup" && !r.data.session) toast("Revisa tu email para confirmar la cuenta", 6000);
  };
}

function authError(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos. Si no la recuerdas, usa «¿Olvidaste tu contraseña?»";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ese correo ya tiene cuenta. Entra o usa «¿Olvidaste tu contraseña?»";
  if (m.includes("rate limit") || m.includes("security purposes")) return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo";
  if (m.includes("not confirmed")) return "Tu correo aún no está confirmado: abre el enlace que te enviamos";
  if (m.includes("same_password") || m.includes("different from the old")) return "La contraseña nueva debe ser distinta de la anterior";
  if (m.includes("weak") || m.includes("at least")) return "Contraseña muy débil: usa al menos 8 caracteres con letras y números";
  return msg;
}

function renderNewPassword() {
  $("#app").innerHTML = `
  <div class="auth">
    <div class="brand" style="font-size:22px;text-align:center;margin-bottom:16px">True Trader<span>X</span></div>
    <div class="card">
      <h2>Crea tu contraseña nueva</h2>
      <form id="pwForm" class="grid">
        <div><label>Contraseña nueva (mínimo 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
        <div><label>Repítela</label><input name="password2" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="btn primary">Guardar contraseña</button>
      </form>
    </div>
  </div>`;
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.password2) return toast("Las contraseñas no coinciden");
    const { error } = await sb.auth.updateUser({ password: f.password });
    if (error) return toast(authError(error.message), 7000);
    toast("Contraseña actualizada");
    S.recovering = false;
    history.replaceState(null, "", location.pathname);
    start();
  };
}

// ---------- render principal ----------
function render() {
  S.charts.forEach((c) => c.destroy());
  S.charts = [];
  const st = S.settings ?? {};
  const isAdmin = S.profile?.role === "admin";
  const tabs = [["panel", "Panel"], ["pos", "Posiciones"], ["hist", "Historial"], ["sig", "Señales"], ["cfg", "Configuración"]];
  if (isAdmin) tabs.push(["admin", "Admin"]);

  $("#app").innerHTML = `
  <header class="top">
    <div class="brand">True Trader<span>X</span></div>
    <nav class="tabs">${tabs.map(([k, v]) => `<button data-tab="${k}" class="${S.tab === k ? "active" : ""}">${v}</button>`).join("")}</nav>
    <div class="spacer"></div>
    ${DEMO ? `<span class="badge">DEMO</span>` : ""}
    <span class="badge ${st.mode === "live" ? "live" : "paper"}">${st.mode === "live" ? "REAL" : "PAPER"}</span>
    <span class="mono muted" title="Capital de la cuenta">${usd(st.last_equity)}</span>
    <label class="check" title="Encender / apagar el bot">
      <span class="switch"><input type="checkbox" id="botToggle" ${st.enabled ? "checked" : ""}><span></span></span>
      <span>${st.enabled ? "Bot activo" : "Bot apagado"}</span>
    </label>
    ${DEMO ? "" : `<button class="btn sm" id="logout">Salir</button>`}
  </header>
  <main id="view"></main>`;

  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); }));
  $("#botToggle").onchange = (e) => toggleBot(e.target.checked);
  if (!DEMO) $("#logout").onclick = () => sb.auth.signOut();

  const view = $("#view");
  if (!S.profile?.approved) {
    view.innerHTML = `<div class="alert info">Tu cuenta está pendiente de aprobación por el administrador. Mientras tanto puedes configurar tu broker y tu lista de activos.</div>`;
    if (S.tab !== "cfg") return;
  }
  const banners = [];
  if (st.last_error) banners.push(`<div class="alert">⚠ ${esc(st.last_error)}</div>`);
  if (!st.has_keys) banners.push(`<div class="alert info">Conecta tu broker en <b>Configuración</b> para que el bot pueda operar.</div>`);
  view.insertAdjacentHTML("beforeend", banners.join(""));
  ({ panel: viewPanel, pos: viewPositions, hist: viewHistory, sig: viewSignals, cfg: viewConfig, admin: viewAdmin })[S.tab](view);
}

async function toggleBot(on) {
  if (on && !S.settings.has_keys) {
    toast("Primero conecta tu broker");
    return render();
  }
  if (on && S.settings.mode === "live" && !confirm("El bot operará con DINERO REAL. ¿Confirmas?")) return render();
  await saveSettings({ enabled: on });
  toast(on ? "Bot encendido" : "Bot apagado");
}

async function saveSettings(patch) {
  Object.assign(S.settings, patch);
  if (!DEMO) {
    const { error } = await sb.from("bot_settings").update(patch).eq("user_id", S.user.id);
    if (error) toast(error.message);
  }
  render();
}

// ---------- estadísticas ----------
function computeStats(trades) {
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => +t.realized_pnl > 0);
  const td = today();
  const todays = trades.filter((t) => etDay(t.opened_at) === td);
  const open = trades.filter((t) => t.status === "open");
  const gw = wins.reduce((s, t) => s + +t.realized_pnl, 0);
  const gl = -closed.filter((t) => +t.realized_pnl <= 0).reduce((s, t) => s + +t.realized_pnl, 0);
  const byDay = {};
  for (const t of [...trades].reverse()) {
    const d = (byDay[etDay(t.opened_at)] ??= { trades: 0, pnl: 0, wins: 0 });
    d.trades++;
    d.pnl += +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0);
    if (t.status === "closed" && +t.realized_pnl > 0) d.wins++;
  }
  return {
    total: closed.reduce((s, t) => s + +t.realized_pnl, 0),
    today: todays.reduce((s, t) => s + +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0), 0),
    tradesToday: todays.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    closed: closed.length,
    open: open.length,
    unreal: open.reduce((s, t) => s + +(t.unrealized_pnl ?? 0), 0),
    pf: gl ? gw / gl : null,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: closed.length - wins.length ? -gl / (closed.length - wins.length) : 0,
    byDay,
  };
}

function kpi(label, value, sub = "", klass = "") {
  return `<div class="card kpi"><h3>${label}</h3><div class="v num ${klass}">${value}</div><div class="s">${sub}</div></div>`;
}

// ---------- vistas ----------
function viewPanel(v) {
  const k = computeStats(S.trades);
  const days = Object.entries(k.byDay).slice(-30);
  v.insertAdjacentHTML("beforeend", `
  <section class="grid kpis">
    ${kpi("P&L hoy", usd(k.today), `${k.tradesToday} trades hoy`, cls(k.today))}
    ${kpi("P&L total", usd(k.total), `${k.closed} trades cerrados`, cls(k.total))}
    ${kpi("Win rate", k.winRate == null ? "—" : k.winRate.toFixed(0) + "%", `Factor de beneficio ${k.pf ? k.pf.toFixed(2) : "—"}`)}
    ${kpi("Abiertas", k.open, `Flotante ${usd(k.unreal)}`, cls(k.unreal))}
    ${kpi("Ganancia media", usd(k.avgWin), `Pérdida media ${usd(k.avgLoss)}`)}
  </section>
  <section class="grid cols-2">
    <div class="card"><h3>P&L acumulado</h3><div class="chart-box"><canvas id="chEquity"></canvas></div></div>
    <div class="card"><h3>Trades y P&L por día</h3><div class="chart-box"><canvas id="chDays"></canvas></div></div>
  </section>
  <section class="card">
    <h3>Últimas operaciones</h3>
    ${tradesTable(S.trades.slice(0, 8))}
  </section>`);

  if (!window.Chart) return;
  Chart.defaults.color = "#8b98a8";
  Chart.defaults.borderColor = "#243040";
  Chart.defaults.font.family = "Inter";
  let acc = 0;
  const closed = S.trades.filter((t) => t.status === "closed").sort((a, b) => a.closed_at.localeCompare(b.closed_at));
  S.charts.push(new Chart($("#chEquity"), {
    type: "line",
    data: {
      labels: closed.map((t) => etDay(t.closed_at)),
      datasets: [{
        data: closed.map((t) => (acc += +t.realized_pnl)), borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.12)",
        fill: true, tension: .25, pointRadius: 0, borderWidth: 2,
      }],
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  }));
  S.charts.push(new Chart($("#chDays"), {
    data: {
      labels: days.map(([d]) => d.slice(5)),
      datasets: [
        { type: "bar", label: "P&L", data: days.map(([, d]) => d.pnl), yAxisID: "y",
          backgroundColor: days.map(([, d]) => (d.pnl >= 0 ? "rgba(34,197,94,.7)" : "rgba(239,68,68,.7)")), borderRadius: 4 },
        { type: "line", label: "Trades", data: days.map(([, d]) => d.trades), yAxisID: "y1", borderColor: "#38bdf8", pointRadius: 2, tension: .2 },
      ],
    },
    options: {
      maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10 } } },
      scales: { y: { position: "left" }, y1: { position: "right", grid: { display: false }, ticks: { precision: 0 } } },
    },
  }));
}

function tradesTable(rows) {
  if (!rows.length) return `<div class="empty">Aún no hay operaciones</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th>Setup</th><th>Contrato</th><th class="num">Cant.</th>
    <th class="num">Entrada</th><th class="num">Salida</th><th class="num">P&L</th><th>Estado / motivo</th></tr></thead>
    <tbody>${rows.map((t) => {
      const pnl = t.status === "open" ? +(t.unrealized_pnl ?? 0) + +t.realized_pnl : +t.realized_pnl;
      return `<tr class="clickable" data-trade="${t.id}">
        <td>${etDay(t.opened_at)} <span class="muted">${etTime(t.opened_at)}</span></td>
        <td><b>${esc(t.symbol)}</b></td>
        <td><span class="badge ${t.direction === "CALL" ? "call" : "put"}">${t.direction}</span></td>
        <td>${esc(SETUPS[t.setup] ?? t.setup)}</td>
        <td class="mono">${t.strike} · ${esc(t.expiry)}</td>
        <td class="num">${t.status === "open" ? `${t.qty_open}/${t.qty}` : t.qty}</td>
        <td class="num">${usd(t.entry_price)}</td>
        <td class="num">${t.exit_price ? usd(t.exit_price) : "—"}</td>
        <td class="num ${cls(pnl)}">${usd(pnl)}</td>
        <td>${t.status === "open" ? `<span class="badge">ABIERTA</span>` : esc(t.exit_reason ?? "")}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function bindTradeRows(v) {
  v.querySelectorAll("[data-trade]").forEach((tr) => (tr.onclick = async () => {
    const id = +tr.dataset.trade;
    const next = tr.nextElementSibling;
    if (next?.classList.contains("detail")) return next.remove();
    if (!S.events[id]) await loadEvents([id]);
    tr.insertAdjacentHTML("afterend", `<tr class="detail"><td colspan="10">${timeline(S.events[id] ?? [])}</td></tr>`);
  }));
}

function timeline(events) {
  if (!events.length) return `<div class="muted">Sin eventos</div>`;
  return `<ul class="timeline">${events.map((e) =>
    `<li><span class="muted mono">${etTime(e.ts)}</span><span class="k-${esc(e.kind)}">${esc(e.message)}</span></li>`).join("")}</ul>`;
}

function viewPositions(v) {
  const open = S.trades.filter((t) => t.status === "open");
  v.insertAdjacentHTML("beforeend", `
  <div class="row" style="margin-bottom:12px">
    <h2 style="margin:0">Posiciones abiertas (${open.length})</h2><div class="spacer"></div>
    ${open.length ? `<button class="btn danger" id="closeAll">Cerrar todo</button>` : ""}
  </div>
  ${open.length ? `<div class="grid cols-2">${open.map(posCard).join("")}</div>` : `<div class="card empty">No hay posiciones abiertas. El vigilante revisa cada 2 minutos cuando hay trades.</div>`}`);
  v.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeTrade(+b.dataset.close)));
  const ca = $("#closeAll");
  if (ca) ca.onclick = async () => {
    if (!confirm("¿Cerrar TODAS las posiciones a mercado?")) return;
    try { await action({ action: "close_all" }); toast("Órdenes de cierre enviadas"); } catch (e) { toast(e.message); }
  };
}

function posCard(t) {
  const d = t.direction === "CALL" ? 1 : -1;
  const R = Math.abs(t.entry_underlying - t.init_stop_underlying) || 1;
  const prog = t.last_underlying ? (d * (t.last_underlying - t.entry_underlying)) / R : 0;
  const pnl = +(t.unrealized_pnl ?? 0) + +t.realized_pnl;
  const optPct = t.last_option_bid ? ((t.last_option_bid - t.entry_price) / t.entry_price) * 100 : 0;
  // Barra: de -1R (stop inicial) a +3R.
  const pctOf = (r) => Math.max(0, Math.min(100, ((r + 1) / 4) * 100));
  const stopR = (d * (t.stop_underlying - t.entry_underlying)) / R;
  const stages = ["Stop inicial", "Breakeven", "Trailing EMA20", "Trailing ajustado"];
  return `<div class="card pos-card">
    <div class="head">
      <span class="sym">${esc(t.symbol)}</span>
      <span class="badge ${d > 0 ? "call" : "put"}">${t.direction}</span>
      <span class="muted mono">${esc(t.option_symbol)}</span>
      <div class="spacer"></div>
      <span class="num ${cls(pnl)}" style="font-size:18px;font-weight:700">${usd(pnl)}</span>
    </div>
    <div class="stats">
      <div><small>Contratos</small><b class="num">${t.qty_open}/${t.qty}</b></div>
      <div><small>Prima entrada → bid</small><b class="num">${usd(t.entry_price)} → ${usd(t.last_option_bid)}</b></div>
      <div><small>Prima</small><b class="num ${cls(optPct)}">${optPct.toFixed(1)}%</b></div>
      <div><small>Subyacente</small><b class="num">${t.last_underlying ? (+t.last_underlying).toFixed(2) : "—"}</b></div>
      <div><small>Stop dinámico</small><b class="num">${(+t.stop_underlying).toFixed(2)}</b></div>
      <div><small>Progreso</small><b class="num ${cls(prog)}">${prog.toFixed(2)}R</b></div>
    </div>
    <div class="muted" style="font-size:12px">${esc(SETUPS[t.setup] ?? t.setup)} · score ${t.score} · delta ${t.delta} · vence ${esc(t.expiry)} · ${stages[t.stage] ?? ""}</div>
    <div class="bar" title="De -1R (stop inicial) a +3R">
      <i style="left:${pctOf(Math.min(stopR, prog))}%;width:${Math.abs(pctOf(prog) - pctOf(stopR))}%;background:${prog >= stopR ? "rgba(34,197,94,.5)" : "rgba(239,68,68,.5)"}"></i>
      <i style="left:calc(${pctOf(stopR)}% - 1px);width:3px;background:#f59e0b"></i>
    </div>
    <h3 style="margin-top:4px">Vigilante</h3>
    ${timeline(S.events[t.id] ?? [])}
    <div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn danger sm" data-close="${t.id}">Cerrar posición</button></div>
  </div>`;
}

async function closeTrade(id) {
  if (!confirm("¿Cerrar esta posición ahora?")) return;
  try { await action({ action: "close_trade", trade_id: id }); toast("Orden de cierre enviada"); } catch (e) { toast(e.message); }
}

function viewHistory(v) {
  const days = [...new Set(S.trades.map((t) => etDay(t.opened_at)))];
  v.insertAdjacentHTML("beforeend", `
  <div class="card">
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0">Historial</h2><div class="spacer"></div>
      <select id="dayFilter" style="width:auto"><option value="">Todos los días</option>${days.map((d) => `<option>${d}</option>`).join("")}</select>
      <select id="setupFilter" style="width:auto"><option value="">Todos los setups</option>${Object.entries(SETUPS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>
    </div>
    <div id="histSummary" class="muted" style="margin-bottom:8px"></div>
    <div id="histTable"></div>
  </div>`);
  const draw = () => {
    const day = $("#dayFilter").value, setup = $("#setupFilter").value;
    const rows = S.trades.filter((t) => (!day || etDay(t.opened_at) === day) && (!setup || t.setup === setup));
    const k = computeStats(rows);
    $("#histSummary").innerHTML = `${rows.length} trades · win rate ${k.winRate == null ? "—" : k.winRate.toFixed(0) + "%"} · P&L <span class="${cls(k.total)}">${usd(k.total)}</span> · clic en una fila para ver la bitácora del vigilante`;
    $("#histTable").innerHTML = tradesTable(rows);
    bindTradeRows($("#histTable"));
  };
  $("#dayFilter").onchange = draw;
  $("#setupFilter").onchange = draw;
  draw();
}

function viewSignals(v) {
  v.insertAdjacentHTML("beforeend", `
  <div class="card">
    <h2>Señales detectadas</h2>
    <p class="muted">El scanner revisa tus activos 1 minuto después de cada cierre de vela de 15M. Solo se opera si el score ≥ tu mínimo (${S.settings?.min_score}).</p>
    ${S.signals.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Hora (NY)</th><th>Activo</th><th>Dirección</th><th>Setup</th><th class="num">Score</th><th class="num">Precio</th><th class="num">Stop</th><th class="num">Objetivo</th><th>4H / 1H</th><th>Motivos</th></tr></thead>
      <tbody>${S.signals.map((s) => `<tr>
        <td>${etDay(s.bar_time).slice(5)} ${etTime(s.bar_time)}</td><td><b>${esc(s.symbol)}</b></td>
        <td><span class="badge ${s.direction === "CALL" ? "call" : "put"}">${s.direction}</span></td>
        <td>${esc(SETUPS[s.setup] ?? s.setup)}</td>
        <td class="num ${s.score >= (S.settings?.min_score ?? 60) ? "pos" : "muted"}">${s.score}</td>
        <td class="num">${(+s.price).toFixed(2)}</td><td class="num">${(+s.stop).toFixed(2)}</td><td class="num">${s.target ? (+s.target).toFixed(2) : "—"}</td>
        <td>${esc(s.bias_4h)} / ${esc(s.bias_1h)}</td>
        <td class="muted" style="white-space:normal;min-width:240px">${esc((s.reasons ?? []).join(" · "))}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Sin señales todavía</div>`}
  </div>`);
}

function viewConfig(v) {
  const s = S.settings ?? {};
  v.insertAdjacentHTML("beforeend", `
  <section class="card">
    <h2>Broker</h2>
    <p class="muted">${s.has_keys ? `Conectado a <b>${esc(s.broker)}</b> (${s.mode === "live" ? "REAL" : "paper"}) · llave ${esc(s.key_hint)} · capital ${usd(s.last_equity)}` : "Sin conectar."}
    Las llaves se cifran en el servidor y nunca vuelven al navegador.</p>
    <form id="keysForm" class="form">
      <div><label>Broker</label><select name="broker" id="brokerSel">
        <option value="alpaca" ${s.broker === "alpaca" ? "selected" : ""}>Alpaca</option>
        <option value="tradier" ${s.broker === "tradier" ? "selected" : ""}>Tradier</option></select></div>
      <div><label>Cuenta</label><select name="mode">
        <option value="paper" ${s.mode !== "live" ? "selected" : ""}>Paper (simulada)</option>
        <option value="live" ${s.mode === "live" ? "selected" : ""}>Real (dinero real)</option></select></div>
      <div id="keyIdBox"><label>API Key ID</label><input name="key_id" autocomplete="off"></div>
      <div><label id="secretLbl">API Secret</label><input name="secret" type="password" autocomplete="off" required></div>
      <div id="acctBox" hidden><label>Account ID</label><input name="account_id" autocomplete="off"></div>
      <div style="grid-column:1/-1" class="row">
        <button class="btn primary">Guardar y probar</button>
        ${s.has_keys ? `<button type="button" class="btn" id="testKeys">Probar</button><button type="button" class="btn danger" id="delKeys">Borrar</button>` : ""}
      </div>
    </form>
  </section>

  <section class="card">
    <h2>Riesgo y contratos</h2>
    <form id="riskForm" class="form">
      ${num("alloc_pct", "% del capital por trade", s.alloc_pct, 0.5, 50, 0.5)}
      ${num("max_contracts", "Máx. contratos por trade", s.max_contracts, 1, 500, 1)}
      ${num("max_open_positions", "Máx. posiciones abiertas", s.max_open_positions, 1, 20, 1)}
      ${num("max_trades_per_day", "Máx. trades por día", s.max_trades_per_day, 1, 50, 1)}
      ${num("daily_loss_limit_pct", "Pérdida diaria máx. (%)", s.daily_loss_limit_pct, 0.5, 100, 0.5)}
      ${num("option_stop_pct", "Stop de prima (%)", s.option_stop_pct, 5, 100, 1)}
      ${num("delta_min", "Delta mínimo", s.delta_min, 0.05, 0.95, 0.01)}
      ${num("delta_max", "Delta máximo", s.delta_max, 0.05, 0.95, 0.01)}
      ${num("dte_min", "Vencimiento mín. (días)", s.dte_min, 0, 30, 1)}
      ${num("dte_max", "Vencimiento máx. (días)", s.dte_max, 0, 45, 1)}
      ${num("max_spread_pct", "Spread bid/ask máx. (%)", s.max_spread_pct, 1, 50, 1)}
      ${num("min_score", "Score mínimo de entrada", s.min_score, 0, 100, 1)}
      <div><label>&nbsp;</label><label class="check"><input type="checkbox" name="close_eod" ${s.close_eod ? "checked" : ""}> Cerrar todo a las 15:50 NY</label></div>
      <div><label>&nbsp;</label><label class="check"><input type="checkbox" name="skip_lunch" ${s.skip_lunch ? "checked" : ""}> No operar en almuerzo (11:30–13:30)</label></div>
      <div style="grid-column:1/-1"><label>Estrategias activas</label><div class="row">
        ${Object.entries(SETUPS).map(([k, n]) => `<label class="check"><input type="checkbox" name="setup" value="${k}" ${(s.setups ?? []).includes(k) ? "checked" : ""}> ${n}</label>`).join("")}
      </div></div>
      <div style="grid-column:1/-1"><button class="btn primary">Guardar</button></div>
    </form>
  </section>

  <section class="card">
    <h2>Lista de activos</h2>
    <p class="muted">El bot solo opera estos símbolos. Usa acciones/ETFs con opciones semanales líquidas.</p>
    <form id="watchForm" class="row" style="margin-bottom:12px">
      <input name="symbol" placeholder="Ej: AAPL" style="max-width:160px;text-transform:uppercase" required pattern="[A-Za-z.\\-]{1,10}">
      <button class="btn">Agregar</button>
    </form>
    <div class="row">${S.watch.map((w) => `
      <span class="badge" style="padding:6px 10px;font-size:13px;${w.active ? "" : "opacity:.45"}">
        <a href="#" data-wtoggle="${w.id}" style="color:inherit;text-decoration:none" title="Activar/pausar">${esc(w.symbol)}</a>
        <a href="#" data-wdel="${w.id}" class="muted" style="margin-left:6px;text-decoration:none" title="Quitar">×</a>
      </span>`).join("") || `<span class="muted">Lista vacía</span>`}</div>
  </section>`);

  const syncBroker = () => {
    const b = $("#brokerSel").value;
    $("#keyIdBox").hidden = b !== "alpaca";
    $("#acctBox").hidden = b !== "tradier";
    $("#secretLbl").textContent = b === "alpaca" ? "API Secret" : "Access Token";
  };
  $("#brokerSel").onchange = syncBroker;
  syncBroker();

  $("#keysForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.mode === "live" && !confirm("Vas a conectar una cuenta con DINERO REAL. ¿Continuar?")) return;
    try {
      const r = await action({ action: "save_keys", ...f });
      if (!r) return;
      toast(`Conectado. Capital: ${usd(r.equity)}`);
      await loadAll();
      render();
    } catch (err) { toast("Error: " + err.message, 6000); }
  };
  $("#testKeys")?.addEventListener("click", async () => {
    try { const r = await action({ action: "test_broker" }); if (r) toast(`OK · capital ${usd(r.equity)} · poder de compra ${usd(r.buyingPower)}`); } catch (err) { toast(err.message); }
  });
  $("#delKeys")?.addEventListener("click", async () => {
    if (!confirm("¿Borrar las llaves del broker? El bot se apagará.")) return;
    try { await action({ action: "delete_keys" }); await loadAll(); render(); } catch (err) { toast(err.message); }
  });

  $("#riskForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {};
    for (const k of ["alloc_pct", "max_contracts", "max_open_positions", "max_trades_per_day", "daily_loss_limit_pct", "option_stop_pct",
      "delta_min", "delta_max", "dte_min", "dte_max", "max_spread_pct", "min_score"]) patch[k] = Number(fd.get(k));
    patch.close_eod = fd.get("close_eod") === "on";
    patch.skip_lunch = fd.get("skip_lunch") === "on";
    patch.setups = fd.getAll("setup");
    if (patch.delta_min >= patch.delta_max) return toast("El delta mínimo debe ser menor que el máximo");
    if (patch.dte_min > patch.dte_max) return toast("Revisa el rango de vencimiento");
    await saveSettings(patch);
    toast("Configuración guardada");
  };

  $("#watchForm").onsubmit = async (e) => {
    e.preventDefault();
    const symbol = new FormData(e.target).get("symbol").trim().toUpperCase();
    if (DEMO) { S.watch.push({ id: Date.now(), symbol, active: true }); return render(); }
    const { error } = await sb.from("watchlist").insert({ user_id: S.user.id, symbol });
    if (error) return toast(error.message);
    await loadAll();
    render();
  };
  v.querySelectorAll("[data-wtoggle]").forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const w = S.watch.find((x) => x.id === +a.dataset.wtoggle);
    w.active = !w.active;
    if (!DEMO) await sb.from("watchlist").update({ active: w.active }).eq("id", w.id);
    render();
  }));
  v.querySelectorAll("[data-wdel]").forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const id = +a.dataset.wdel;
    S.watch = S.watch.filter((x) => x.id !== id);
    if (!DEMO) await sb.from("watchlist").delete().eq("id", id);
    render();
  }));
}

function num(name, label, value, min, max, step) {
  return `<div><label>${label}</label><input type="number" name="${name}" value="${value ?? ""}" min="${min}" max="${max}" step="${step}" required></div>`;
}

async function viewAdmin(v) {
  v.insertAdjacentHTML("beforeend", `<section class="card"><h2>Usuarios</h2><div id="users" class="muted">Cargando…</div></section>
  <section class="card"><h2>Alertas de seguridad y errores</h2><div id="alerts" class="muted">Cargando…</div></section>
  <section class="card"><h2>Salud del bot</h2><div id="runs" class="muted">Cargando…</div></section>`);
  if (DEMO) {
    for (const id of ["#users", "#alerts", "#runs"]) $(id).innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`;
    return;
  }
  viewAlerts();
  const [{ data: users }, { data: trades }, { data: settings }, { data: runs }] = await Promise.all([
    sb.from("profiles").select("*").order("created_at"),
    sb.from("trades").select("user_id, status, realized_pnl, unrealized_pnl").limit(10000),
    sb.from("bot_settings").select("user_id, enabled, mode, has_keys, last_equity, last_error"),
    sb.from("bot_runs").select("*").order("ts", { ascending: false }).limit(40),
  ]);
  $("#users").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Usuario</th><th>Rol</th><th>Aprobado</th><th>Bot</th><th>Cuenta</th><th class="num">Capital</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">P&L</th><th>Último error</th></tr></thead>
    <tbody>${(users ?? []).map((u) => {
      const st = settings?.find((s) => s.user_id === u.id) ?? {};
      const k = computeStats((trades ?? []).filter((t) => t.user_id === u.id).map((t) => ({ ...t, opened_at: new Date().toISOString() })));
      return `<tr>
        <td><b>${esc(u.full_name)}</b><br><span class="muted">${esc(u.email)}</span></td>
        <td><select data-role="${u.id}" style="width:auto" ${u.id === S.user.id ? "disabled" : ""}><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option></select></td>
        <td><label class="switch"><input type="checkbox" data-approve="${u.id}" ${u.approved ? "checked" : ""} ${u.id === S.user.id ? "disabled" : ""}><span></span></label></td>
        <td>${st.enabled ? `<span class="pos">ON</span>` : `<span class="muted">OFF</span>`}</td>
        <td>${st.has_keys ? `<span class="badge ${st.mode === "live" ? "live" : "paper"}">${st.mode}</span>` : `<span class="muted">sin broker</span>`}</td>
        <td class="num">${usd(st.last_equity)}</td><td class="num">${k.closed + k.open}</td>
        <td class="num">${k.winRate == null ? "—" : k.winRate.toFixed(0) + "%"}</td><td class="num ${cls(k.total)}">${usd(k.total)}</td>
        <td class="muted" style="white-space:normal;max-width:260px">${esc(st.last_error ?? "")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  v.querySelectorAll("[data-approve]").forEach((c) => (c.onchange = async () => {
    const { error } = await sb.from("profiles").update({ approved: c.checked }).eq("id", c.dataset.approve);
    toast(error ? error.message : c.checked ? "Usuario aprobado" : "Acceso revocado");
  }));
  v.querySelectorAll("[data-role]").forEach((c) => (c.onchange = async () => {
    const { error } = await sb.from("profiles").update({ role: c.value }).eq("id", c.dataset.role);
    toast(error ? error.message : "Rol actualizado");
  }));
  $("#runs").innerHTML = (runs ?? []).length ? `<div class="table-wrap"><table>
    <thead><tr><th>Hora (NY)</th><th>Función</th><th>Estado</th><th class="num">ms</th><th>Detalle</th></tr></thead>
    <tbody>${runs.map((r) => `<tr><td>${etDay(r.ts).slice(5)} ${etTime(r.ts)}</td><td>${esc(r.fn)}</td>
      <td>${r.ok ? `<span class="pos">OK</span>` : `<span class="neg">ERROR</span>`}</td><td class="num">${r.duration_ms}</td>
      <td class="muted" style="white-space:normal">${esc(r.message)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">Sin ejecuciones todavía. Revisa que el cron esté configurado.</div>`;
}

async function viewAlerts() {
  const [{ data: topic }, { data: cfg }, { data: log }] = await Promise.all([
    sb.rpc("alert_topic"),
    sb.from("alert_settings").select("*").eq("id", 1).single(),
    sb.from("alert_log").select("*").order("ts", { ascending: false }).limit(25),
  ]);
  const url = topic ? `https://ntfy.sh/${topic}` : "";
  $("#alerts").innerHTML = `
    <p class="muted">Te avisamos de intentos de acceso no autorizados, registros nuevos, cambios de llaves o roles, cuenta real activada,
    errores del scanner/vigilante/broker y si el bot deja de correr. Cada tipo de alerta se envía como máximo una vez cada ${cfg?.throttle_minutes ?? 15} min.</p>
    <div class="grid cols-2">
      <div>
        <label>Notificaciones en el celular</label>
        <p style="margin:4px 0 8px">1) Instala la app <b>ntfy</b> (Android / iPhone) · 2) "Subscribe to topic" · 3) escribe este topic:</p>
        <div class="row"><code class="mono badge" style="font-size:13px;padding:6px 10px">${esc(topic ?? "—")}</code>
        <a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir en el navegador</a></div>
        <p class="muted" style="font-size:12px">Guárdalo en privado: quien conozca el topic puede leer las alertas.</p>
      </div>
      <form id="alertForm" class="grid">
        <div><label>Correo para alertas</label><input name="email" type="email" value="${esc(cfg?.email ?? "")}"></div>
        <label class="check"><input type="checkbox" name="email_enabled" ${cfg?.email_enabled ? "checked" : ""}> Enviar por correo (seguridad y errores)</label>
        <p class="muted" style="font-size:12px;margin:0">El correo necesita una llave gratuita de Resend guardada en Vault como <code>resend_api_key</code> (ver README). Sin ella solo llega la push.</p>
        <label class="check"><input type="checkbox" name="push_enabled" ${cfg?.push_enabled ? "checked" : ""}> Alertas activas</label>
        <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" id="testAlert">Enviar prueba</button></div>
      </form>
    </div>
    <h3 style="margin-top:16px">Últimas alertas</h3>
    ${(log ?? []).length ? `<div class="table-wrap"><table><thead><tr><th>Hora (NY)</th><th>Tipo</th><th>Alerta</th><th>Detalle</th><th>Enviada</th></tr></thead><tbody>
      ${log.map((a) => `<tr><td>${etDay(a.ts).slice(5)} ${etTime(a.ts)}</td>
        <td><span class="${a.level === "security" ? "neg" : a.level === "error" ? "" : "muted"}">${esc(a.level)}</span></td>
        <td>${esc(a.title)}</td><td class="muted" style="white-space:normal">${esc(a.message)}</td>
        <td>${a.sent ? "sí" : `<span class="muted">agrupada</span>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Sin alertas todavía</div>`}`;
  $("#alertForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { error } = await sb.from("alert_settings").update({
      email: fd.get("email") || null, email_enabled: fd.get("email_enabled") === "on", push_enabled: fd.get("push_enabled") === "on",
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    toast(error ? error.message : "Alertas guardadas");
  };
  $("#testAlert").onclick = async () => {
    const { error } = await sb.rpc("send_test_alert");
    toast(error ? error.message : "Alerta de prueba enviada: revisa tu celular y tu correo");
    viewAlerts();
  };
}

// ---------- datos de demostración ----------
function demoData() {
  const syms = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMZN", "META", "MSFT"];
  const setups = ["vela_maestra", "rebote_ema20", "iman", "vela_maestra", "rebote_ema20"];
  const trades = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const reasons = ["Stop dinámico tocado en el subyacente", "Imán: toque de EMA20", "Cierre de fin de día", "Reversión anticipada: mecha larga de toma de ganancias (5M)", "Vela de peligro 15M cruza la EMA20"];
  for (let i = 0; i < 46; i++) {
    const day = new Date(Date.now() - Math.floor(i / 2.2) * 86400000);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    day.setUTCHours(14, 5 + Math.floor(rnd() * 200), 0);
    const entry = +(1.2 + rnd() * 3).toFixed(2);
    const win = rnd() < 0.62;
    const exit = +(entry * (win ? 1 + 0.1 + rnd() * 0.6 : 1 - 0.1 - rnd() * 0.35)).toFixed(2);
    const qty = 2 + Math.floor(rnd() * 6);
    const sym = syms[Math.floor(rnd() * syms.length)];
    trades.push({
      id: i + 1, symbol: sym, direction: rnd() < 0.6 ? "CALL" : "PUT", setup: setups[i % setups.length], score: 60 + Math.floor(rnd() * 30),
      option_symbol: `${sym}261002C00${Math.floor(100 + rnd() * 400)}000`, strike: Math.floor(100 + rnd() * 400), expiry: "2026-10-02",
      delta: +(0.4 + rnd() * 0.1).toFixed(2), qty, qty_open: 0, entry_price: entry, exit_price: exit,
      realized_pnl: +((exit - entry) * qty * 100).toFixed(2), status: "closed", exit_reason: win ? reasons[Math.floor(rnd() * 4)] : reasons[4 * (rnd() < 0.5) || 0],
      opened_at: day.toISOString(), closed_at: new Date(day.getTime() + 3600e3).toISOString(),
    });
  }
  const now = new Date();
  trades.unshift({
    id: 999, symbol: "NVDA", direction: "CALL", setup: "vela_maestra", score: 78, option_symbol: "NVDA261002C00185000", strike: 185,
    expiry: "2026-10-02", delta: 0.48, qty: 6, qty_open: 3, entry_price: 2.35, last_option_bid: 3.1, entry_underlying: 184.2,
    init_stop_underlying: 183.1, stop_underlying: 184.31, last_underlying: 185.9, stage: 1, realized_pnl: 171, unrealized_pnl: 225,
    status: "open", opened_at: new Date(now - 50 * 60e3).toISOString(),
  });
  const ev = (m, k, min) => ({ kind: k, message: m, ts: new Date(now - min * 60e3).toISOString() });
  return {
    profile: { role: "admin", approved: true, full_name: "Demo" },
    settings: {
      enabled: true, mode: "paper", broker: "alpaca", has_keys: true, key_hint: "…DEMO", last_equity: 25340.12, alloc_pct: 5, max_contracts: 10,
      max_open_positions: 3, max_trades_per_day: 4, daily_loss_limit_pct: 6, option_stop_pct: 40, delta_min: 0.4, delta_max: 0.5, dte_min: 5, dte_max: 10,
      max_spread_pct: 12, min_score: 60, close_eod: true, skip_lunch: true, setups: ["vela_maestra", "rebote_ema20", "iman", "momentum"],
    },
    trades,
    events: {
      999: [
        ev("Stop movido 183.10 → 184.31 (etapa 1, 1.05R)", "stop", 8),
        ev("Parcial: vendidos 3 a $2.92 (171.00 USD) — Asegurar 50% en +0.5R; stop a breakeven", "partial", 22),
        ev("Compra 6x NVDA261002C00185000 a $2.35 · vela_maestra (score 78) · delta 0.48 · stop subyacente 183.10", "entry", 50),
      ],
    },
    watch: syms.map((s, i) => ({ id: i + 1, symbol: s, active: true })),
    signals: [
      { bar_time: new Date(now - 50 * 60e3).toISOString(), symbol: "NVDA", direction: "CALL", setup: "vela_maestra", score: 78, price: 184.2, stop: 183.1, target: 186.4, bias_1h: "CALL", bias_4h: "CALL", reasons: ["1ª vela 15M sólida marca intención", "2ª vela confirma sin devolver 50%", "4H alineado"] },
      { bar_time: new Date(now - 35 * 60e3).toISOString(), symbol: "META", direction: "PUT", setup: "rebote_ema20", score: 55, price: 702.4, stop: 705.1, target: 695.2, bias_1h: "PUT", bias_4h: "LATERAL", reasons: ["precio besa la EMA20 en tendencia", "volumen débil"] },
    ],
  };
}

boot();
