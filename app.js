import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js?v=202609211327";

// Si config.js no está configurado, el panel arranca en MODO DEMO con datos de ejemplo.
const DEMO = SUPABASE_URL.includes("TU-PROYECTO");
const sb = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const S = { user: null, profile: null, settings: null, trades: [], signals: [], watch: [], setups: [], textos: {}, predeterminados: {}, tab: "panel", charts: [], macro: null, macroSel: "^GSPC" };

// EL CATALOGO LLEGA DE LA BASE Y SOLO SI QUIEN MIRA ES ADMIN. Si no llegó, se enseña la clave
// cruda: fea, pero nunca una estrategia con nombre y explicación en un fichero público.
const nombreSetup = (k, porDefecto) => S.setups.find((x) => x.clave === k)?.nombre ?? porDefecto ?? k;
const queEsSetup = (k) => S.setups.find((x) => x.clave === k)?.que_es ?? "";

// LOS TEXTOS DE CONFIGURACION TAMPOCO VIAJAN EN ESTE FICHERO. Las etiquetas del formulario de
// riesgo y estrategia no eran nombres de campo: contaban el metodo y, en varias, el resultado
// medido que justifica el valor. Como el catalogo de estrategias, viven en una tabla que solo
// lee el admin. (Este comentario tampoco repite ninguna: iria en el mismo fichero publico.)
//
// SOLO LA PARTE DE ADMIN. El formulario del broker y la pantalla de entrada siguen con su
// texto aqui: un usuario tiene que poder conectar su broker, y nadie puede quedarse mirando
// una pantalla de login con las claves crudas.
/** El texto de una etiqueta por su clave. Si no llego el diccionario, se ve la clave. */
const tx = (clave) => S.textos[clave] ?? clave;
const setupsElegibles = () => S.setups.filter((x) => x.elegible).map((x) => x.clave);
/** Los grupos tal y como se enseñan en Configuración, en el orden que trae la tabla. */
function gruposSetups() {
  const out = [];
  for (const s of S.setups) {
    if (!s.elegible || !s.grupo) continue;
    const g = out.find(([titulo]) => titulo === s.grupo);
    if (g) g[1].push(s.clave); else out.push([s.grupo, [s.clave]]);
  }
  return out;
}

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (n) => (n == null || isNaN(n) ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cls = (n) => (+n > 0 ? "pos" : +n < 0 ? "neg" : "");
/**
 * EL COLOR SE LEE DEL CSS, NO SE ESCRIBE AQUI. Las graficas usaban hexadecimales sueltos y al
 * cambiar la paleta se quedaban con los de antes sin que nadie se diera cuenta. `tok("accent")`
 * devuelve lo que valga hoy `--accent`, asi que tema y graficas no se pueden desincronizar.
 */
const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();

/**
 * UNA RAYA DE REFERENCIA EN LA CURVA DE DINERO.
 *
 * En P&L la referencia es el cero; en capital, el capital de partida. Es la unica raya que importa:
 * sin ella el ojo no sabe si la curva esta por encima o por debajo de donde empezo.
 *
 * Va como plugin y no como color de rejilla porque pintarla con la rejilla exige que una marca del
 * eje caiga EXACTAMENTE en el valor, y las marcas van a numeros redondos: sobre un capital de
 * 100.322 no cae ninguna y la raya no aparece nunca.
 */
const lineaReferencia = {
  id: "lineaReferencia",
  afterDatasetsDraw(chart, _args, opts) {
    const y = opts?.valor;
    if (y == null || !Number.isFinite(y)) return;
    const { ctx, chartArea, scales } = chart;
    const py = scales.y?.getPixelForValue(y);
    if (py == null || py < chartArea.top || py > chartArea.bottom) return;
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148,163,184,.45)";
    ctx.beginPath();
    ctx.moveTo(chartArea.left, py);
    ctx.lineTo(chartArea.right, py);
    ctx.stroke();
    ctx.restore();
  },
};
/** El mismo color con transparencia, para los degradados de area. */
const tokA = (n, a) => `color-mix(in srgb, ${tok(n)} ${Math.round(a * 100)}%, transparent)`;

const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// LA HORA EN 12 HORAS, con am/pm en minuscula. Peticion suya del 14/10/2026: "cuando son las
// 13:00 es la 1 pm, y asi, no uses mas ese formato de 24h".
const hora12 = (mins) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
};
// Lo mismo desde un texto "HH:MM". Lo que no encaje ("todo el día", "antes de abrir") pasa igual.
const hora12De = (txt) => {
  const s = String(txt ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? hora12(+m[1] * 60 + +m[2]) : s;
};
const etTime = (iso) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return hora12(g("hour") * 60 + g("minute"));
};
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

// ---------- app instalable (teléfono, tablet y computadora) ----------
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // se muestra nuestro botón "Instalar app" en lugar del aviso del navegador
  installEvt = e;
  if (S.user) render();
});
addEventListener("appinstalled", () => {
  installEvt = null;
  toast("App instalada ✅");
  if (S.user) render();
});
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function installable() {
  return !isStandalone() && (installEvt !== null || isIOS());
}
async function installApp() {
  if (installEvt) {
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    return render();
  }
  // iPhone / iPad: Safari no tiene botón de instalar automático.
  toast("En iPhone/iPad: abre esta página en Safari, toca Compartir (□↑) y luego «Agregar a pantalla de inicio».", 9000);
}

// ---------- arranque ----------
/** El sello con el que se cargo este fichero. Lo pone index.html en el ?v= del script. */
const VERSION = new URL(import.meta.url).searchParams.get("v") ?? "";

/** Mira si el servidor ya tiene otro sello y, si lo tiene, ofrece recargar. */
async function miraSiHayVersionNueva() {
  if (!VERSION || document.getElementById("versionNueva")) return;
  try {
    const html = await (await fetch("index.html", { cache: "no-store" })).text();
    const sello = html.match(/app\.js\?v=([0-9]+)/)?.[1];
    if (!sello || sello === VERSION) return;
  } catch { return; } // Sin red no hay nada que decir; ya volvera a mirar.
  document.body.insertAdjacentHTML("beforeend", `<div id="versionNueva" class="version-nueva">
    <span>Hay una versión nueva del panel</span>
    <button class="btn primary sm" id="recargarVersion">Actualizar</button></div>`);
  document.getElementById("recargarVersion").onclick = () => location.reload();
}

async function boot() {
  if (DEMO) {
    Object.assign(S, demoData());
    return render();
  }
  // El enlace de "olvidé mi contraseña" llega con type=recovery en la URL.
  // El enlace de invitación (type=invite) también pide crear la contraseña.
  S.recovering = /type=(recovery|invite)/.test(location.hash + location.search);
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
  miraSiHayVersionNueva();
  setInterval(miraSiHayVersionNueva, 5 * 60_000);
  // En el móvil esto es lo que cuenta: la app se queda abierta y se vuelve a ella.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) miraSiHayVersionNueva();
  });
}

async function start() {
  if (!S.user) return renderAuth();
  await loadAll();
  render();
  subscribe();
}

async function loadAll() {
  const uid = S.user.id;
  const [p, s, t, w, sig, mac] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).single(),
    // mi_cuenta y mis_operaciones en vez de las tablas: las vistas devuelven todo si quien pregunta
    // es administrador, y solo lo suyo -sin estrategia, sin stops, sin motivos reales- si es un
    // usuario. Esconderlo en la interfaz no servía: la llave pública leía las tablas directamente.
    sb.from("mi_cuenta").select("*").eq("user_id", uid).single(),
    sb.from("mis_operaciones").select("*").eq("user_id", uid).order("opened_at", { ascending: false }).limit(1000),
    sb.from("watchlist").select("*").eq("user_id", uid).order("symbol"),
    sb.from("signals").select("*").order("ts", { ascending: false }).limit(60),
    // LA FOTO DEL ESCENARIO MACRO. La hace la funcion `macro` cada 15 minutos: el panel es una
    // pagina estatica y no puede llamar a Yahoo (CORS, y catorce peticiones por cada persona que
    // abriera esto).
    sb.from("macro_snapshot").select("*").order("creado_en", { ascending: false }).limit(1),
  ]);
  S.profile = p.data;
  S.settings = s.data;
  // Los ajustes completos solo existen para el administrador; para un usuario esta consulta no
  // devuelve nada y su pantalla de broker se dibuja igual con lo que trae mi_cuenta.
  if (p.data?.role === "admin") {
    const { data: full } = await sb.from("bot_settings").select("*").eq("user_id", uid).single();
    if (full) S.settings = { ...s.data, ...full };
  }
  S.trades = t.data ?? [];
  S.watch = w.data ?? [];
  S.signals = sig.data ?? [];
  S.macro = mac.data?.[0] ?? null;
  // El catálogo de estrategias: su política lo da solo al admin, así que para un usuario esto
  // vuelve vacío y las pantallas que lo usan no son suyas de todos modos.
  if (esAdmin()) {
    const [{ data: cat }, { data: txt }, { data: pre }] = await Promise.all([
      sb.from("setups_catalogo").select("*").order("orden"),
      sb.from("textos_panel").select("clave,texto"),
      sb.from("predeterminados").select("clave,valor"),
    ]);
    S.setups = cat ?? [];
    S.textos = Object.fromEntries((txt ?? []).map((r) => [r.clave, r.texto]));
    S.predeterminados = Object.fromEntries((pre ?? []).map((r) => [r.clave, r.valor]));
  }
}

let channel;
function subscribe() {
  // Los avisos en vivo de Postgres solo llegan a quien puede leer la tabla, y un usuario ya no puede.
  // Para él, un refresco cada 30 segundos hace el mismo trabajo sin enseñarle nada.
  if (S.profile?.role !== "admin") {
    clearInterval(window.__ttxRefresco);
    window.__ttxRefresco = setInterval(() => loadAll().then(render), 30000);
  }
  if (channel) sb.removeChannel(channel);
  let pending;
  const refresh = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => { await loadAll(); render(); }, 600);
  };
  // LAS OPERACIONES VAN POR LA VIA LIGERA. Son las que llegan cada segundo y medio.
  let pendienteVivo;
  const vivo = () => {
    clearTimeout(pendienteVivo);
    pendienteVivo = setTimeout(refrescoVivo, 600);
  };
  channel = sb.channel("live")
    .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: `user_id=eq.${S.user.id}` }, vivo)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "trade_events", filter: `user_id=eq.${S.user.id}` }, refresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, refresh)
    .subscribe();
}

// ---------- autenticación ----------
/** Campo de contraseña con botón de ojo para verla (evita errores al escribirla). */
function passField(label, name, autocomplete) {
  return `<div><label>${label}</label>
    <div class="pass-wrap">
      <input name="${name}" type="password" minlength="8" required autocomplete="${autocomplete}">
      <button type="button" class="pass-eye" data-for="${name}" title="Ver u ocultar la contraseña" aria-label="Ver u ocultar la contraseña">👁</button>
    </div></div>`;
}

/** Activa los botones de ojo de la pantalla actual. */
function bindEyes() {
  for (const b of document.querySelectorAll(".pass-eye")) {
    b.onclick = () => {
      const input = b.parentElement.querySelector("input");
      const ver = input.type === "password";
      input.type = ver ? "text" : "password";
      b.textContent = ver ? "🙈" : "👁";
      input.focus();
    };
  }
}

function renderAuth(mode = "login") {
  $("#app").innerHTML = `
  <div class="auth">
    <div class="brand brand-lg"><img src="logo.svg" alt="Master X" class="logo"><b class="brand-name">True Trader<span>X</span></b></div>
    <div class="card">
      <h2>${mode === "login" ? "Entrar" : "Crear cuenta"}</h2>
      <form id="authForm" class="grid">
        ${mode === "signup" ? `<div><label>Nombre</label><input name="name" required></div>` : ""}
        <div><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
        ${passField("Contraseña", "password", mode === "login" ? "current-password" : "new-password")}
        <button class="btn primary">${mode === "login" ? "Entrar" : "Registrarme"}</button>
      </form>
      ${mode === "login" ? `<button class="btn" id="forgot" style="width:100%;margin-top:8px">🔑 Olvidé mi contraseña</button>` : ""}
      <p class="muted" style="margin-bottom:0;margin-top:12px">
        ${mode === "login" ? `¿No tienes cuenta? <a href="#" id="swap">Regístrate</a>` : `¿Ya tienes cuenta? <a href="#" id="swap">Entrar</a>`}
      </p>
    </div>
  </div>`;
  bindEyes();
  $("#swap").onclick = (e) => { e.preventDefault(); renderAuth(mode === "login" ? "signup" : "login"); };
  $("#forgot")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const campo = $("#authForm [name=email]");
    const email = campo.value.trim();
    if (!email) { campo.focus(); return toast("Escribe primero tu email aquí arriba y vuelve a pulsar el botón", 6000); }
    const btn = $("#forgot");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    btn.disabled = false;
    btn.textContent = "🔑 Olvidé mi contraseña";
    toast(error ? authError(error.message) : `Te enviamos un correo a ${email} para crear una contraseña nueva (mira también la carpeta de spam)`, 9000);
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
    <div class="brand brand-lg"><img src="logo.svg" alt="Master X" class="logo"><b class="brand-name">True Trader<span>X</span></b></div>
    <div class="card">
      <h2>Crea tu contraseña nueva</h2>
      <form id="pwForm" class="grid">
        ${passField("Contraseña nueva (mínimo 8 caracteres)", "password", "new-password")}
        ${passField("Repítela", "password2", "new-password")}
        <button class="btn primary">Guardar contraseña</button>
      </form>
    </div>
  </div>`;
  bindEyes();
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
// =============================================================================================
// EL REFRESCO QUE NO REHACE EL PANEL ENTERO.
//
// 21/10/2026, el: "la app se para cada vez que se mueve el grafico, sobre todo cuando hay una
// posicion abierta".
//
// Con una posicion abierta el vigilante escribe en `trades` cada ~1,5 segundos. Cada escritura
// llegaba por realtime y disparaba `loadAll()` (seis consultas) + `render()`, que destruye los
// dos graficos de Chart.js, reemplaza el innerHTML del panel entero y los vuelve a crear.
// Medido en el navegador: 16-29 ms de hilo principal bloqueado por repintado en un portatil.
// En un movil son facilmente 60-150 ms, cada segundo y medio.
//
// Mientras solo se mueven los numeros de una posicion YA abierta, aqui se repintan tres trozos
// —los KPI, la tabla de abiertas y las fichas de Posiciones— y los graficos ni se tocan. Solo
// cuando se abre o se cierra algo, que es cuando la curva de dinero y los contadores historicos
// cambian de verdad, se rehace todo.
// =============================================================================================

/** La huella de lo que obliga a rehacer el panel: que operaciones hay y en que estado. */
const huellaTrades = (ts) => ts.map((x) => `${x.id}:${x.status}`).join(",");

/** Repinta solo lo que se mueve con el precio. Devuelve false si no habia nada que repintar. */
function repintarVivo() {
  const k = computeStats(S.trades, S.settings?.panel_desde ?? null);
  const kp = document.getElementById("kpis");
  const ab = document.getElementById("abiertasPanel");
  const lp = document.getElementById("listaPos");
  if (!kp && !ab && !lp) return false;
  if (kp) kp.innerHTML = kpisHTML(k);
  if (ab) ab.innerHTML = abiertasHTML(k);
  if (lp) lp.innerHTML = listaPosHTML(S.trades.filter((x) => x.status === "open"));
  // El HTML es nuevo: sus botones necesitan volver a engancharse.
  engancharCerrar(document);
  return true;
}

/** Una sola consulta. Si cambia el conjunto de operaciones, se rehace todo; si no, se repinta. */
async function refrescoVivo() {
  if (DEMO || !S.user) return;
  const { data } = await sb.from("mis_operaciones").select("*").eq("user_id", S.user.id)
    .order("opened_at", { ascending: false }).limit(1000);
  if (!data) return;
  const antes = huellaTrades(S.trades);
  S.trades = data;
  if (antes !== huellaTrades(S.trades) || !repintarVivo()) render();
}

/**
 * AVISA DE QUE UNA TABLA TIENE MAS A LA DERECHA.
 *
 * En un movil las tablas de ocho columnas no caben y se arrastran, pero una tabla cortada en seco
 * parece una tabla rota: nada dice que haya mas. Se enciende un difuminado en el borde derecho, y
 * se apaga solo al llegar al final para no mentir diciendo que queda algo cuando no queda.
 */
function marcarTablasDesplazables(raiz = document) {
  raiz.querySelectorAll(".table-wrap").forEach((caja) => {
    const actualizar = () => caja.classList.toggle("hay-mas", caja.scrollWidth - caja.clientWidth - caja.scrollLeft > 4);
    if (!caja.dataset.marcada) {
      caja.dataset.marcada = "1";
      caja.addEventListener("scroll", actualizar, { passive: true });
    }
    actualizar();
  });
}

/**
 * Y lo vuelve a mirar cuando cambia algo. Las tablas no llegan todas al pintar: `viewAdmin` es
 * asincrona, y los filtros del historial repintan la suya al vuelo. En vez de adivinar cuando,
 * se observa el contenedor. Con freno de 80 ms para no recalcular en cada mutacion suelta.
 */
function vigilarTablas() {
  const view = document.querySelector("#view");
  if (!view || view.dataset.vigilada) return;
  view.dataset.vigilada = "1";
  let t = 0;
  const pronto = () => { clearTimeout(t); t = setTimeout(() => marcarTablasDesplazables(view), 80); };
  new MutationObserver(pronto).observe(view, { childList: true, subtree: true });
  addEventListener("resize", pronto, { passive: true });
}

function render() {
  S.charts.forEach((c) => c.destroy());
  S.charts = [];
  const st = S.settings ?? {};
  const isAdmin = S.profile?.role === "admin";
  // Usuarios (no admin): solo lo básico. La estrategia y la configuración son del administrador.
  const tabs = isAdmin
    ? [["panel", "Panel"], ["pos", "Posiciones"], ["hist", "Historial"], ["sig", "Señales"], ["ai", "Inteligencia"], ["cfg", "Configuración"], ["admin", "Admin"]]
    // El usuario tiene tres sitios y ninguno cuenta cómo trabaja el bot: su panel, sus posiciones
    // abiertas y la pantalla para conectar su broker. El historial completo queda fuera porque un
    // listado de entradas con su hora y su activo, puesto al lado de un gráfico, es la estrategia.
    : [["panel", "Panel"], ["pos", "Posiciones"], ["cfg", "Mi broker"]];
  if (!tabs.some(([k]) => k === S.tab)) S.tab = "panel";

  $("#app").innerHTML = `
  <header class="top">
    <div class="brand"><img src="logo.svg" alt="Master X" class="logo"><b class="brand-name">True Trader<span>X</span></b></div>
    <nav class="tabs">${tabs.map(([k, v]) => `<button data-tab="${k}" class="${S.tab === k ? "active" : ""}">${v}</button>`).join("")}</nav>
    <div class="spacer"></div>
    ${DEMO ? `<span class="badge">DEMO</span>` : ""}
    <span class="badge ${st.mode === "live" ? "live" : "paper"}">${st.mode === "live" ? "REAL" : "PAPER"}</span>
    <span class="mono muted" title="Capital de la cuenta">${usd(st.last_equity)}</span>
    <label class="check" title="Encender / apagar el bot">
      <span class="switch"><input type="checkbox" id="botToggle" ${st.enabled ? "checked" : ""}><span></span></span>
      <span>${st.enabled ? "Bot activo" : "Bot apagado"}</span>
    </label>
    ${installable() ? `<button class="btn sm" id="installApp" title="Instalar True TraderX como app">📲 Instalar app</button>` : ""}
    ${DEMO ? "" : `<button class="btn sm" id="logout">Salir</button>`}
  </header>
  <main id="view"></main>`;

  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); }));
  $("#botToggle").onchange = (e) => toggleBot(e.target.checked);
  if (!DEMO) $("#logout").onclick = () => sb.auth.signOut();
  $("#installApp")?.addEventListener("click", installApp);

  const view = $("#view");
  if (!S.profile?.approved) {
    view.innerHTML = `<div class="alert info">Tu cuenta está pendiente de aprobación por el administrador. Mientras tanto puedes conectar tu broker en «Mi broker».</div>`;
    if (S.tab !== "cfg") return;
  }
  const banners = [];
  if (st.last_error) banners.push(`<div class="alert">⚠ ${esc(st.last_error)}</div>`);
  if (!st.has_keys) banners.push(`<div class="alert info">👋 <b>Bienvenido a True TraderX.</b> Solo te falta un paso: conecta tu broker en <b>${isAdmin ? "Configuración → Broker" : "Mi broker"}</b>. La estrategia y los stops ya vienen configurados por el administrador, y el bot se enciende solo al conectar.</div>`);
  view.insertAdjacentHTML("beforeend", banners.join(""));
  ({ panel: viewPanel, pos: viewPositions, hist: viewHistory, sig: viewSignals, ai: viewIntelligence, cfg: viewConfig, admin: viewAdmin })[S.tab](view);
  vigilarTablas();
  marcarTablasDesplazables(view);
}

async function toggleBot(on) {
  if (on && !S.settings.has_keys) {
    toast("Primero conecta tu broker");
    return render();
  }
  if (on && S.settings.mode === "live" && !confirm("El bot operará con DINERO REAL. ¿Confirmas?")) return render();
  if (DEMO) {
    S.settings.enabled = on;
    toast(on ? "Bot encendido" : "Bot apagado");
    return render();
  }
  // El interruptor se bloquea mientras el servidor contesta: dos clics seguidos dejarian la
  // pantalla diciendo una cosa y la base de datos otra.
  const sw = $("#botToggle");
  if (sw) sw.disabled = true;
  try {
    const r = await action({ action: on ? "bot_encender" : "bot_apagar" });
    if (!r) throw new Error("sin respuesta del servidor");
    S.settings.enabled = r.enabled;
    // Apagar NO abandona lo que esta abierto: el vigilante sigue con su stop y su toma de
    // ganancia hasta que cierren. Se dice con esas palabras para que nadie se quede en la duda.
    toast(
      r.enabled
        ? "Bot encendido"
        : r.abiertas
        ? `Bot apagado: no abrirá entradas nuevas. Las ${r.abiertas} posiciones abiertas siguen vigiladas hasta que cierren.`
        : "Bot apagado: no abrirá entradas nuevas.",
      r.abiertas && !r.enabled ? 7000 : 3000,
    );
  } catch (err) {
    // Lo importante: el interruptor vuelve a donde estaba. Nunca se queda diciendo lo que no es.
    toast("No se pudo cambiar: " + err.message, 6000);
  }
  render();
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
/**
 * desde (YYYY-MM-DD, hora de Nueva York): el panel solo cuenta lo abierto a partir de ese día. Sirve
 * para empezar una etapa de cero sin borrar nada; el historial y los agentes siguen con todo.
 * Las posiciones que siguen abiertas se cuentan siempre, caigan antes o después del corte: son
 * dinero vivo y están a la vista en la tabla de posiciones.
 */
function computeStats(todas, desde) {
  const abiertas = todas.filter((t) => t.status === "open");
  const trades = desde
    ? todas.filter((t) => t.status === "open" || etDay(t.opened_at) >= desde)
    : todas;
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => +t.realized_pnl > 0);
  const td = today();
  const todays = trades.filter((t) => etDay(t.opened_at) === td);
  const open = abiertas;
  const gw = wins.reduce((s, t) => s + +t.realized_pnl, 0);
  const gl = -closed.filter((t) => +t.realized_pnl <= 0).reduce((s, t) => s + +t.realized_pnl, 0);
  const byDay = {};
  for (const t of [...trades].reverse()) {
    const d = (byDay[etDay(t.opened_at)] ??= { trades: 0, pnl: 0, wins: 0 });
    d.trades++;
    d.pnl += +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0);
    if (t.status === "closed" && +t.realized_pnl > 0) d.wins++;
  }
  // Dinero realmente puesto y dinero que vale ahora lo que hay abierto: una opcion cotiza por accion,
  // asi que el desembolso es prima x 100 x contratos. Es como lo enseña cualquier broker.
  const coste = open.reduce((a, t) => a + +t.entry_price * 100 * +t.qty_open, 0);
  const valor = open.reduce((a, t) => a + +(t.last_option_bid ?? 0) * 100 * +t.qty_open, 0);
  const cerradasHoy = todays.filter((t) => t.status === "closed");
  const ganadasHoy = cerradasHoy.filter((t) => +t.realized_pnl > 0).length;
  return {
    ganadasHoy,
    perdidasHoy: cerradasHoy.length - ganadasHoy,
    winRateHoy: cerradasHoy.length ? (ganadasHoy / cerradasHoy.length) * 100 : null,
    abiertasHoy: todays.filter((t) => t.status === "open").length,
    total: closed.reduce((s, t) => s + +t.realized_pnl, 0),
    today: todays.reduce((s, t) => s + +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0), 0),
    tradesToday: todays.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    ganadas: wins.length,
    perdidas: closed.length - wins.length,
    cerradasHoy: cerradasHoy.length,
    coste,
    valor,
    closed: closed.length,
    open: open.length,
    unreal: open.reduce((s, t) => s + +(t.unrealized_pnl ?? 0), 0),
    pf: gl ? gw / gl : null,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: closed.length - wins.length ? -gl / (closed.length - wins.length) : 0,
    byDay,
  };
}

function kpi(label, value, sub = "", klass = "", anillo = "") {
  return `<div class="card kpi">${anillo}<div class="txt"><h3>${label}</h3>
    <div class="v num ${klass}">${value}</div><div class="s">${sub}</div></div></div>`;
}

/**
 * EL RELOJ DE PROGRESO. Un anillo SVG de trazo fino, con su pista detras y el numero dentro.
 *
 * SOLO PARA MAGNITUDES ACOTADAS, y esto no es un capricho: una aguja necesita un maximo. Un
 * porcentaje de acierto va de 0 a 100 y el anillo dice algo. El P&L no tiene techo, asi que
 * ponerle un reloj seria inventarse una escala — esas cifras se quedan como numero grande.
 *
 * `pct` puede venir null (todavia no hay nada cerrado): entonces se pinta la pista sola, sin arco.
 * No se pinta un cero, que no es lo mismo que "no hay dato".
 *
 * VA SIN NUMERO DENTRO a proposito. La primera version lo llevaba y la tarjeta acababa diciendo
 * "100%" dos veces, dentro del anillo y al lado en grande. El anillo es la forma; el numero, el
 * numero. Repetirlo no añade nada y ensucia.
 */
function anillo(pct, colorTok = "accent") {
  // 42 px y no 50: a 50 el rotulo "ACIERTO TOTAL" se quedaba sin sitio y partia en dos lineas.
  const R = 17, C = 2 * Math.PI * R;
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const hueco = C * (1 - v / 100);
  return `<svg class="anillo" width="42" height="42" viewBox="0 0 42 42" role="img"
    aria-label="${pct == null ? "sin dato" : Math.round(v) + " por ciento"}">
    <circle class="pista" cx="21" cy="21" r="${R}" fill="none" stroke-width="4"></circle>
    ${pct == null ? "" : `<circle class="valor" cx="21" cy="21" r="${R}" fill="none" stroke-width="4"
      stroke="var(--${colorTok})" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${hueco.toFixed(2)}"
      style="filter:drop-shadow(0 0 5px color-mix(in srgb, var(--${colorTok}) 55%, transparent))"></circle>`}
  </svg>`;
}

// ---------- vistas ----------
/** Calendario económico: tira de días de la semana; al tocar un día se ven sus eventos. */
async function loadCalendario() {
  const box = $("#calendario");
  if (!box) return;
  if (DEMO) return (box.innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  const hoy = etDay(new Date().toISOString());
  const { data } = await sb.from("calendar_events").select("*").gte("day", hoy).order("day").order("time_et");
  if (!data?.length) {
    return (box.innerHTML = `<div class="empty">Sin eventos cargados. Se actualiza cada mañana a las 6:40 AM NY.</div>`);
  }
  // LAS CIFRAS QUE YA TENIAMOS GUARDADAS Y NO SE ENSEÑABAN. La tabla trae previsión y dato
  // anterior de casi todos los eventos macro (y beneficio por acción esperado en resultados), y
  // el panel las estaba tirando. Son el detalle que convierte "Existing Home Sales" en algo que
  // se puede leer de un vistazo: si sale por debajo de lo previsto, el mercado reacciona.
  const cifras = (e) => {
    const partes = [];
    if (e.consensus) partes.push(`${e.kind === "earnings" ? "se espera" : "previsión"} ${esc(e.consensus)}`);
    if (e.previous) partes.push(`${e.kind === "earnings" ? "año pasado" : "anterior"} ${esc(e.previous)}`);
    return partes.length ? `<span class="cal-cifras">${partes.join(" · ")}</span>` : "";
  };

  const porDia = {};
  for (const e of data) (porDia[e.day] ??= []).push(e);
  const dias = Object.keys(porDia).slice(0, 5);
  const LETRA = ["D", "L", "M", "X", "J", "V", "S"];
  const chip = (d) => {
    const f = new Date(d + "T12:00:00Z");
    const evs = porDia[d];
    const fuerte = evs.some((e) => e.importance >= 3 && e.kind === "macro");
    const earn = evs.some((e) => e.kind === "earnings");
    const medio = evs.some((e) => e.importance === 2);
    return `<button class="cal-day${d === hoy ? " hoy" : ""}" data-dia="${d}">
      <span class="cal-dow">${LETRA[f.getUTCDay()]}</span>
      <span class="cal-num">${f.getUTCDate()}</span>
      <span class="cal-dots">${fuerte ? '<i class="dot alta"></i>' : ""}${earn ? '<i class="dot earn"></i>' : ""}${!fuerte && !earn && medio ? '<i class="dot media"></i>' : ""}</span>
    </button>`;
  };
  box.innerHTML = `<div class="cal-strip">${dias.map(chip).join("")}</div><div class="cal-list" id="calLista"></div>`;

  const pinta = (d) => {
    for (const b of box.querySelectorAll(".cal-day")) b.classList.toggle("sel", b.dataset.dia === d);
    const evs = (porDia[d] ?? []).filter((e) => e.importance >= 2).slice(0, 5);
    const f = new Date(d + "T12:00:00Z");
    const titulo = d === hoy ? "Hoy" : f.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    $("#calLista").innerHTML = evs.length
      ? `<div class="cal-tit">${titulo}</div>` + evs.map((e) => `
        <div class="cal-ev">
          <span class="cal-hora">${esc(hora12De(e.time_et).replace("todo el día", "—"))}</span>
          <i class="dot ${e.kind === "earnings" ? "earn" : e.importance >= 3 ? "alta" : "media"}"></i>
          <div class="cal-cuerpo">
            <span class="cal-txt">${esc(e.symbol ? `${e.symbol}: resultados` : e.title)}</span>
            ${e.resumen ? `<span class="cal-res">${esc(e.resumen)}</span>` : ""}
            ${cifras(e)}
          </div>
        </div>`).join("")
      : `<div class="cal-tit">${titulo}</div><div class="cal-ev muted">Sin eventos relevantes</div>`;
  };
  for (const b of box.querySelectorAll(".cal-day")) b.onclick = () => pinta(b.dataset.dia);
  pinta(dias.includes(hoy) ? hoy : dias[0]);

  const fuertesHoy = (porDia[hoy] ?? []).filter((e) => e.importance >= 3).length;
  $("#calMeta").innerHTML = fuertesHoy
    ? `<i class="dot alta"></i> ${fuertesHoy} evento${fuertesHoy > 1 ? "s" : ""} clave hoy`
    : "día tranquilo";
}

/** Los seis recuadros de arriba del Panel. Se repintan solos cuando se mueve una abierta. */
function kpisHTML(k) {
  return `
    ${kpi("P&L hoy", usd(k.today), `${k.tradesToday} operaciones hoy`, cls(k.today))}
    ${kpi("P&L total", usd(k.total), `${k.closed} operaciones cerradas`, cls(k.total))}
    ${kpi(
      "Acierto hoy",
      k.winRateHoy == null ? "—" : `${k.winRateHoy.toFixed(0)}%`,
      k.cerradasHoy
        ? `<span class="rec-w">${k.ganadasHoy}G</span> · <span class="rec-l">${k.perdidasHoy}P</span>${k.abiertasHoy ? ` · ${k.abiertasHoy} abierta${k.abiertasHoy > 1 ? "s" : ""}` : ""}`
        : k.abiertasHoy ? `Sin cerrar aún · ${k.abiertasHoy} abierta${k.abiertasHoy > 1 ? "s" : ""}` : "Sin operaciones hoy",
      "",
      // El anillo se pinta del color del resultado, pero el numero y las letras G/P van al lado:
      // el color acompaña, nunca decide solo.
      anillo(k.winRateHoy, k.winRateHoy == null ? "muted" : k.winRateHoy >= 50 ? "green" : "red"),
    )}
    ${kpi(
      "Acierto total",
      k.winRate == null ? "—" : `${k.winRate.toFixed(0)}%`,
      k.closed ? `<span class="rec-w">${k.ganadas}G</span> · <span class="rec-l">${k.perdidas}P</span> · factor ${k.pf ? k.pf.toFixed(2) : "—"}` : "Sin histórico",
      "",
      anillo(k.winRate, k.winRate == null ? "muted" : k.winRate >= 50 ? "green" : "red"),
    )}
    ${kpi("Abiertas", k.open, k.open ? `Puesto ${usd(k.coste)} · vale ${usd(k.valor)}` : "Nada abierto", cls(k.unreal))}
    ${kpi("Ganancia media", usd(k.avgWin), `Pérdida media ${usd(k.avgLoss)}`)}
`;
}

/** La tarjeta de posiciones abiertas del Panel, cabecera y tabla. */
function abiertasHTML(k) {
  return `
    <div class="row"><h3 style="margin:0">Posiciones abiertas (${k.open})</h3><div class="spacer"></div>
      ${k.open ? `<span class="num ${cls(k.unreal)}" style="font-weight:700">${usd(k.unreal)} flotante</span>` : ""}</div>
    ${posicionesTabla(S.trades.filter((t) => t.status === "open"))}
`;
}

/** Los botones de cerrar, que hay que volver a enganchar cada vez que se repinta su HTML. */
function engancharCerrar(raiz) {
  raiz.querySelectorAll("[data-close]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); closeTrade(+b.dataset.close); }));
}

function viewPanel(v) {
  // Fecha de corte del panel: a partir de aquí se cuenta de cero. No borra nada.
  const desde = S.settings?.panel_desde ?? null;
  const delPanel = desde
    ? S.trades.filter((t) => t.status === "open" || etDay(t.opened_at) >= desde)
    : S.trades;
  const k = computeStats(S.trades, desde);
  // AVANCE DE CAPITAL. Peticion suya del 24/10/2026: *"quiero ver relojes de progreso, avance de
  // capital y graficas en lineas modernas"*.
  //
  // Es LA MISMA curva que habia, contada en capital en vez de en P&L. No se añade una segunda
  // grafica al lado: el P&L acumulado y el capital son la misma linea desplazada por el capital
  // inicial, y pintar las dos es decir lo mismo dos veces ocupando el doble.
  //
  // El capital inicial se deduce restando: lo que vale la cuenta hoy menos lo que lleva ganado.
  // Si el broker no ha reportado capital todavia, no se inventa una base y se enseña el P&L.
  const equityHoy = +(S.settings?.last_equity ?? 0);
  const capIni = equityHoy ? equityHoy - k.total : 0;
  const avance = capIni > 0 ? (k.total / capIni) * 100 : null;
  v.insertAdjacentHTML("beforeend", `
  <section class="grid kpis" id="kpis">${kpisHTML(k)}</section>
  <section class="card" id="abiertasPanel">${abiertasHTML(k)}</section>
  <section class="card">
    <div class="row"><h3 style="margin:0">${capIni > 0 ? "Avance de capital" : "P&L acumulado"}</h3><div class="spacer"></div>
      <span class="num" style="font-size:23px;font-weight:700;letter-spacing:-.5px">${usd(capIni > 0 ? equityHoy : k.total)}</span>
      ${avance == null ? "" : `<span class="badge ${avance >= 0 ? "call" : "put"}">${avance >= 0 ? "▲" : "▼"} ${Math.abs(avance).toFixed(1)}%</span>`}
      <span class="muted sm">${capIni > 0 ? `desde ${usd(capIni)} · ` : ""}${k.closed} cerradas${desde ? ` · desde ${desde}` : ""}</span></div>
    <div class="chart-box alto"><canvas id="chEquity"></canvas></div>
  </section>
  ${esAdmin() ? `  <section class="card cal-card">
    <div class="row"><h3 style="margin:0">Calendario</h3><div class="spacer"></div>
      <span class="muted sm" id="calMeta"></span></div>
    <div id="calendario" class="muted sm">Cargando…</div>
  </section>` : ""}
  <section class="card">
    <h3>Últimas operaciones</h3>
    ${tradesTable(delPanel.slice(0, 8), true)}
  </section>
  ${macroTarjetaHTML()}`);
  engancharCerrar(v);
  bindTradeRows(v);
  if (esAdmin()) loadCalendario();

  if (!window.Chart) return;
  Chart.defaults.color = tok("muted");
  Chart.defaults.borderColor = tok("line");
  Chart.defaults.font.family = "Inter";
  let acc = 0;
  const corte = S.settings?.panel_desde ?? null;
  const closed = S.trades.filter((t) => t.status === "closed" && (!corte || etDay(t.opened_at) >= corte))
    .sort((a, b) => a.closed_at.localeCompare(b.closed_at));
  // El selector y el grafico de la lectura de mercado: el canvas ya esta en el DOM aqui.
  macroActivar();
  S.charts.push(new Chart($("#chEquity"), {
    type: "line",
    plugins: [lineaReferencia],
    data: {
      // El punto de partida va DELANTE. Sin el, la curva nace en la primera operacion y parece
      // que la cuenta empezo ahi; con el, se ve de donde salio.
      labels: ["Inicio", ...closed.map((t) => etDay(t.closed_at))],
      datasets: [{
        data: [capIni, ...closed.map((t) => capIni + (acc += +t.realized_pnl))], borderColor: tok("accent"),
        borderWidth: 2.5, tension: .3,
        // DEGRADADO MUY TENUE, no un area opaca. La linea sigue mandando y el cruce por el cero
        // se sigue viendo, que es lo que pidio el 20/10 al cambiar las barras por una linea.
        //
        // Y CON CAPITAL EL RELLENO VA AL PUNTO DE PARTIDA, no al cero: sobre una cuenta de 100.000
        // un area desde el cero es un bloque solido que no dice nada. Desde el capital inicial, lo
        // sombreado ES lo ganado, y lo que baje de ahi se ve hundirse.
        fill: capIni > 0 ? { value: capIni } : "origin",
        backgroundColor: (c) => {
          const { ctx, chartArea } = c.chart;
          if (!chartArea) return "transparent";
          const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, tokA("accent", 0.22));
          g.addColorStop(1, tokA("accent", 0));
          return g;
        },
        // SOLO EL ULTIMO PUNTO. Con un punto en cada operacion la linea se convierte en un
        // collar; con uno solo, el ojo va directo a donde se esta hoy.
        pointRadius: (c) => (c.dataIndex === c.dataset.data.length - 1 ? 5 : 0),
        pointHoverRadius: 5,
        pointBackgroundColor: tok("accent"), pointBorderColor: tok("bg"), pointBorderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      // AIRE A LA IZQUIERDA. Con el eje en dolares la etiqueta mas larga empieza justo en el borde
      // del lienzo y el simbolo se come un pixel.
      //
      // ERAN CUATRO PUNTOS Y SE QUEDARON CORTOS (24/10/2026): valian para "$3,500", pero al pasar
      // la curva a CAPITAL las etiquetas son de seis cifras ("$27,000") y el dolar salia cortado
      // como ";27,000". Doce puntos cubren ambas.
      layout: { padding: { left: 12, right: 10, top: 8 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        lineaReferencia: { valor: capIni > 0 ? capIni : 0 },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (it) => it[0].label,
            label: (it) =>
              capIni > 0
                // En capital, el numero solo no dice nada: 100.420 no se sabe si es bueno. Al lado
                // va lo que lleva ganado o perdido desde el punto de partida.
                ? [`Capital ${usd(it.parsed.y)}`, `${it.parsed.y - capIni >= 0 ? "+" : "−"}${usd(Math.abs(it.parsed.y - capIni))} desde el inicio`]
                : `Acumulado ${usd(it.parsed.y)}`,
          },
        },
      },
      scales: {
        // CATEGORIA, EXPLICITO. Sin esto Chart.js intenta leer "10-20" como un numero, no le sale,
        // y apelotona todos los puntos a la izquierda dejando medio cuadro vacio. Se veia igual con
        // las barras de antes: es un defecto que ya estaba, no lo trajo el cambio a linea.
        x: { type: "category", ticks: { maxTicksLimit: 6 } },
        // La rejilla, recesiva. La raya de referencia NO se pinta aqui: se dibuja con el plugin
        // `lineaReferencia`, porque atarla a una marca del eje solo funciona si alguna cae justo
        // en el valor, y las marcas van a numeros redondos.
        y: {
          grid: { color: "rgba(148,163,184,.10)" },
          // ANCHO MINIMO DEL EJE. Chart.js ajusta el eje a lo que miden sus etiquetas, y con la
          // curva en capital ("$27,000") se quedaba 2 o 3 pixeles corto: el dolar salia cortado y
          // se leia ";27,000". Subir el relleno del lienzo no lo arregla —el eje se recalcula
          // igual—; lo que lo arregla es darle un suelo de ancho.
          afterFit: (eje) => { eje.width = Math.max(eje.width, 76); },
          // En dolares, sin decimales: es una curva de dinero, no una serie abstracta.
          ticks: { callback: (v) => usd(v).replace(/,00$|\.00$/, "") },
        },
      },
    },
  }));
}

// =============================================================================================
// ANALISIS DE MERCADO, dentro del Panel.
//
// Su foto: un selector arriba a la derecha, el sesgo en una linea, tres tarjetas de marco y un
// grafico con TRES lineas —precio, SMA rapida y SMA lenta—. Eso y nada mas.
//
// LO QUE HACE QUE ESTO AYUDE EN VEZ DE ESTORBAR: en un indice subir es bueno; en un bono lo que
// se cotiza es el RENDIMIENTO, y subir suele ser MALO para la bolsa. Con el VIX igual. Esos van
// marcados y se pintan al reves, o la pantalla diria verde justo el dia en que es un aviso.
// =============================================================================================

const GRUPOS_MACRO = [
  ["etf", "ETF conocidos"],
  ["indice", "Índices"],
  ["sector", "Sectores / temáticos"],
  ["futuro", "Futuros"],
  ["bono", "Bonos del Tesoro"],
];

/** El color de un cambio, teniendo en cuenta si subir es bueno o malo PARA LA BOLSA. */
function colorMacro(cambio, alReves) {
  if (!Number.isFinite(cambio) || Math.abs(cambio) < 0.01) return "muted";
  const bueno = alReves ? cambio < 0 : cambio > 0;
  return bueno ? "pos" : "neg";
}

/**
 * El color de un sesgo, con el mismo cuidado.
 *
 * En un bono "Alcista" es el RENDIMIENTO subiendo, que para la bolsa es lo contrario de una
 * buena noticia. Lo vi renderizado: el bono a 10 anos decia Alcista en verde.
 */
function colorSesgo(sesgo, alReves) {
  if (sesgo !== "Alcista" && sesgo !== "Bajista") return "muted";
  const bueno = alReves ? sesgo === "Bajista" : sesgo === "Alcista";
  return bueno ? "pos" : "neg";
}

/** La tarjeta entera. Devuelve HTML; el grafico se pinta despues, cuando el canvas existe. */
function macroTarjetaHTML() {
  const snap = S.macro;
  if (!snap) {
    return `<div class="card"><h3>Análisis de mercado</h3>
      <p class="muted">Todavía no hay ninguna foto del mercado. Se toma cada media hora entre semana.</p></div>`;
  }
  const L = snap.lecturas ?? [];
  const sel = L.find((l) => l.symbol === S.macroSel) ?? L[0];
  if (!sel) return "";
  const sesgoCls = colorSesgo(snap.sesgo, false) === "muted" ? "muted" : colorSesgo(snap.sesgo, false);

  const opciones = GRUPOS_MACRO.map(([g, titulo]) => {
    const items = L.filter((l) => l.grupo === g);
    if (!items.length) return "";
    return `<optgroup label="${titulo}">` +
      items.map((l) => `<option value="${l.symbol}"${l.symbol === sel.symbol ? " selected" : ""}>${l.nombre}</option>`).join("") +
      "</optgroup>";
  }).join("");

  const c = colorMacro(sel.cambioPct, sel.alRevesParaLaBolsa);
  const flecha = sel.cambioPct > 0 ? "▲" : sel.cambioPct < 0 ? "▼" : "·";

  return `<div class="card">
    <div class="row-between">
      <h3>Análisis de mercado</h3>
      <span class="muted mono small">Actualizado ${new Date(snap.creado_en).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>

    <div class="macro-cab">
      <span class="muted mono small">1H · 1D · 1S</span>
      <select id="macroSel" class="macro-select">${opciones}</select>
    </div>

    <div class="macro-titular ${sesgoCls}">
      <span class="chip ${sesgoCls}">${(snap.sesgo || "").toUpperCase()}</span>
      <span>${snap.titular ?? ""}</span>
    </div>

    <div class="macro-sel-cab">
      <div><b>${sel.nombre}</b> <span class="muted small">${sel.queEs}</span></div>
      <div class="macro-sel-precio">
        <span class="mono">${Number(sel.precio).toLocaleString("es-ES", { maximumFractionDigits: 2 })}${sel.grupo === "bono" ? "%" : ""}</span>
        <span class="mono ${c}">${flecha} ${Math.abs(sel.cambioPct).toFixed(2)}%</span>
      </div>
    </div>
    ${sel.alRevesParaLaBolsa ? `<p class="macro-aviso">Ojo: aquí <b>subir es malo para la bolsa</b>. ${sel.grupo === "bono" ? "Es el rendimiento del bono: si sube, el dinero se va a cobrar sin riesgo." : "Es el índice del miedo."}</p>` : ""}

    <div class="macro-marcos">${(sel.marcos ?? []).map((m) => `
      <div class="macro-marco">
        <div class="row-between"><b>${m.marco === "1H" ? "1 HORA" : m.marco === "1D" ? "1 DÍA" : "1 SEMANA"}</b><span class="muted mono small">RSI ${m.rsi}</span></div>
        <div class="macro-marco-sesgo ${colorSesgo(m.sesgo, sel.alRevesParaLaBolsa)}">${m.sesgo}</div>
        <div class="macro-fila"><span class="muted">Precio</span><span class="mono">${m.precio}</span></div>
        <div class="macro-fila"><span class="muted">SMA ${m.nRapida}</span><span class="mono">${m.smaRapida}</span></div>
        <div class="macro-fila"><span class="muted">SMA ${m.nLenta}</span><span class="mono">${m.smaLenta}</span></div>
        <div class="macro-fila"><span class="muted">MACD</span><span class="mono ${colorSesgo(m.macd, sel.alRevesParaLaBolsa)}">${m.macd}</span></div>
      </div>`).join("")}</div>

    <div class="chart-box"><canvas id="chMacro"></canvas></div>
    <p class="muted small" style="margin-top:10px">
      Indicadores estándar (medias móviles, RSI, MACD) sobre datos de Yahoo Finance.
      Es contexto: <b>el bot no opera con esto</b>, decide con las reglas de su documento.
    </p>
  </div>`;
}

/** Engancha el selector y pinta el grafico. Se llama DESPUES de meter el HTML en el DOM. */
function macroActivar() {
  const s = $("#macroSel");
  if (s) s.onchange = () => { S.macroSel = s.value; render(); };
  const snap = S.macro;
  if (!snap) return;
  const sel = (snap.lecturas ?? []).find((l) => l.symbol === S.macroSel) ?? (snap.lecturas ?? [])[0];
  if (!sel?.serie?.length) return;
  const el = $("#chMacro");
  if (!el || typeof Chart === "undefined") return;
  Chart.defaults.color = "#94a3b8";
  Chart.defaults.borderColor = "rgba(148,163,184,.12)";
  // LAS TRES LINEAS DE SU FOTO. La rapida y la lenta van discontinuas para que se distingan sin
  // depender del color, que es lo que pasa cuando se mira en el movil a contraluz.
  S.charts.push(new Chart(el, {
    type: "line",
    data: {
      labels: (sel.fechas ?? []).map((f) => f.slice(5)),
      datasets: [
        { label: "Precio", data: sel.serie, borderColor: "#818cf8", borderWidth: 2, fill: false, tension: .2, pointRadius: 0 },
        { label: `SMA ${sel.marcos?.find((m) => m.marco === "1D")?.nRapida ?? 20}`, data: sel.smaRapidaSerie ?? [], borderColor: "#34d399", borderWidth: 1.5, borderDash: [5, 4], fill: false, tension: .2, pointRadius: 0, spanGaps: true },
        { label: `SMA ${sel.marcos?.find((m) => m.marco === "1D")?.nLenta ?? 50}`, data: sel.smaLentaSerie ?? [], borderColor: "#f87171", borderWidth: 1.5, borderDash: [2, 3], fill: false, tension: .2, pointRadius: 0, spanGaps: true },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, usePointStyle: false } } },
      scales: { x: { type: "category", ticks: { maxTicksLimit: 7 } } },
    },
  }));
}

function posicionesTabla(open) {
  if (!open.length) {
    return `<div class="empty">No hay posiciones abiertas. Cuando las haya, el vigilante las revisa cada segundo y medio.</div>`;
  }
  const fila = (t) => {
    const d = t.direction === "CALL" ? 1 : -1;
    const R = Math.abs(t.entry_underlying - t.init_stop_underlying) || 1;
    const prog = t.last_underlying ? (d * (t.last_underlying - t.entry_underlying)) / R : 0;
    const pnl = +(t.unrealized_pnl ?? 0) + +t.realized_pnl;
    const bid = +(t.last_option_bid ?? 0);
    const coste = +t.entry_price * 100 * +t.qty_open;
    const valor = bid * 100 * +t.qty_open;
    const puesto = +t.entry_price * 100 * +t.qty;
    return `<tr class="clickable" data-trade="${t.id}">
      <td><b>${esc(t.symbol)}</b> <span class="badge ${d > 0 ? "call" : "put"}">${t.direction}</span></td>
      <td class="mono">${t.strike} · ${esc(t.expiry)}</td>
      <td class="num">${t.qty_open}/${t.qty}</td>
      <td class="num">${usd(t.entry_price)}</td>
      <td class="num">${bid ? usd(bid) : "—"}</td>
      <td class="num muted">${usd(coste)}</td>
      <td class="num">${bid ? usd(valor) : "—"}</td>
      <td class="num ${cls(pnl)}"><b>${usd(pnl)}</b></td>
      <td class="num ${cls(pnl)}">${puesto ? ((pnl / puesto) * 100).toFixed(1) + "%" : "—"}</td>
      ${esAdmin() ? `<td class="num">${(+t.stop_underlying || 0).toFixed(2)}</td><td class="num ${cls(prog)}">${prog.toFixed(2)}R</td>` : ""}
      <td><button class="btn danger sm" data-close="${t.id}" title="Vende todos los contratos de esta posición ahora mismo">Cerrar</button></td>
    </tr>`;
  };
  const coste = open.reduce((a, t) => a + +t.entry_price * 100 * +t.qty_open, 0);
  const valor = open.reduce((a, t) => a + +(t.last_option_bid ?? 0) * 100 * +t.qty_open, 0);
  const pnl = open.reduce((a, t) => a + +(t.unrealized_pnl ?? 0) + +t.realized_pnl, 0);
  const puesto = open.reduce((a, t) => a + +t.entry_price * 100 * +t.qty, 0);
  return `<div class="table-wrap"><table class="broker">
    <thead><tr><th>Activo</th><th>Contrato</th><th class="num">Cant.</th>
      <th class="num">Compra</th><th class="num">Venta ahora</th><th class="num">Coste</th><th class="num">Valor</th>
      <th class="num">P&L</th><th class="num">P&L %</th>
      ${esAdmin() ? '<th class="num">Stop</th><th class="num">Progreso</th>' : ""}<th></th></tr></thead>
    <tbody>${open.map(fila).join("")}</tbody>
    <tfoot><tr>
      <td colspan="5"><b>Total (${open.length})</b></td>
      <td class="num">${usd(coste)}</td><td class="num">${usd(valor)}</td>
      <td class="num ${cls(pnl)}"><b>${usd(pnl)}</b></td>
      <td class="num ${cls(pnl)}">${puesto ? ((pnl / puesto) * 100).toFixed(1) + "%" : "—"}</td>
      ${esAdmin() ? '<td colspan="3"></td>' : '<td></td>'}
    </tr></tfoot></table></div>`;
}

function pctDe(t) {
  const puesto = +t.entry_price * 100 * +t.qty;
  const pnl = +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0);
  if (!puesto) return "—";
  return ((pnl / puesto) * 100).toFixed(1) + "%";
}

/** Solo el administrador ve CÓMO opera el bot. Un usuario ve su dinero. */
const esAdmin = () => S.profile?.role === "admin";

function tradesTable(rows, compacta = false) {
  if (!rows.length) return `<div class="empty">Aún no hay operaciones</div>`;
  // En Historial se ve ademas a cuanto se compro y a cuanto se vendio. En el Panel, ni eso:
  // es una lista de un vistazo. En ningun sitio se pinta ya el contrato, la cantidad ni el
  // motivo de salida, que son la receta del bot y no el resultado de la operacion.
  const precios = !compacta;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th>${precios ? `<th class="num">Compra</th><th class="num">Venta</th>` : ""}
    <th class="num">P&L</th><th class="num">P&L %</th><th>Estado</th></tr></thead>
    <tbody>${rows.map((t) => {
      const pnl = t.status === "open" ? +(t.unrealized_pnl ?? 0) + +t.realized_pnl : +t.realized_pnl;
      return `<tr class="clickable" data-trade="${t.id}">
        <td>${etDay(t.opened_at)} <span class="muted">${etTime(t.opened_at)}</span></td>
        <td><b>${esc(t.symbol)}</b></td>
        <td><span class="badge ${t.direction === "CALL" ? "call" : "put"}">${t.direction}</span></td>
        ${precios ? `<td class="num">${usd(t.entry_price)}</td>
        <td class="num">${t.exit_price ? usd(t.exit_price) : "—"}</td>` : ""}
        <td class="num ${cls(pnl)}"><b>${usd(pnl)}</b></td>
        <td class="num ${cls(pnl)}">${pctDe(t)}</td>
        <td>${t.status === "open" ? `<span class="badge">ABIERTA</span>` : "Cerrada"}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function bindTradeRows(v) {
  // YA NO SE DESPLIEGA NADA, ni para el admin (21/10/2026). Lo unico que queda por hacer es
  // quitar el cursor de mano: una fila que parece pulsable y no hace nada es peor que una fila
  // normal.
  v.querySelectorAll("[data-trade]").forEach((tr) => tr.classList.remove("clickable"));
}

async function bindPatterns() {
  const btn = $("#patternsNow");
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Buscando…";
      try {
        const { data: r, error } = await sb.functions.invoke("patterns", { body: {} });
        if (error) throw error;
        toast(`Historiador: ${r.strong} patrones fuertes en ${r.symbols} activos`, 6000);
        await paintPatterns();
      } catch (err) {
        toast("Error: " + err.message, 6000);
      }
      btn.disabled = false;
      btn.textContent = "Buscar patrones ahora";
    };
  }
  await paintPatterns();
}

async function paintPatterns() {
  const box = $("#aiPatterns");
  if (!box) return;
  if (DEMO) return (box.innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  const { data } = await sb.from("symbol_patterns").select("*").eq("strong", true).order("symbol").order("kind");
  if (!data?.length) {
    return (box.innerHTML = `<div class="empty">Todavía no hay patrones. El historiador corre después del cierre (5:10 PM NY) o puedes lanzarlo ahora.</div>`);
  }
  const bySym = {};
  for (const p of data) (bySym[p.symbol] ??= []).push(p);
  const icon = { hora: "🕐", dia: "📅", hueco: "🪜", racha: "🔁", extension: "🚀" };
  box.innerHTML = `<div class="grid cols-2">${Object.entries(bySym).map(([sym, ps]) => `
    <div><h3>${esc(sym)}</h3><ul style="margin:0;padding-left:18px">
      ${ps.map((p) => `<li style="white-space:normal">${icon[p.kind] ?? "•"} ${esc(p.text)}</li>`).join("")}
    </ul></div>`).join("")}</div>
    <p class="muted" style="margin-top:10px">Solo se muestran los patrones con muestra suficiente (40 casos o más) y diferencia clara.
    Última actualización: ${new Date(data[0].updated_at).toLocaleString("es")}</p>`;
}

async function viewIntelligence(v) {
  v.insertAdjacentHTML("beforeend", `
  ${S.profile?.role === "admin" ? `
  <section class="card">
    <div class="row"><h2 style="margin:0">🤖 La IA que vigila las posiciones</h2><div class="spacer"></div>
      <span class="badge">Solo administrador</span></div>
    <p class="muted">Entra en acción <b>solo cuando ya hay una posición abierta</b>. Mira el movimiento y decide si
    la posición sigue valiendo, o si el objetivo se queda corto y conviene dejarla correr más, marcando los mínimos
    y máximos del tramo.</p>
    <p class="muted"><b>Lo que no puede hacer, diga lo que diga:</b> cancelar el stop del −20% de la prima, evitar el
    cierre antes de la campana, ni abrir nada. Solo puede <b>cortar antes</b> o <b>dejar correr más</b>.</p>
    <div id="iaPanel" class="muted">Cargando…</div>
  </section>` : ""}

  <section class="card">
    <h2>Inteligencia del bot</h2>
    <p class="muted">Los agentes vigilantes guardan cada movimiento de cada posición y cada tarde el agente de aprendizaje
    resume los resultados. Desde el 8/10 <b>solo recomienda</b>: calcula lo que haría, lo propone aquí abajo y
    <b>no cambia nada por su cuenta</b> — ni el score ni las señales. Lo que se aplica lo apruebas tú.</p>
    <div id="aiStats" class="muted">Cargando…</div>
  </section>

  ${S.profile?.role === "admin" ? `
  <section class="card">
    <div class="row"><h2 style="margin:0">💡 Recomendaciones del aprendizaje</h2><div class="spacer"></div>
      <span class="badge">Solo administrador</span></div>
    <p class="muted">Lo que el agente propone con los resultados reales (necesita 8 operaciones cerradas para opinar).
    Nada de esto está aplicado hasta que le des a Aplicar.</p>
    <div id="recos" class="muted">Cargando…</div>
    <h3 style="margin-top:16px">Bloqueos que aprobaste</h3>
    <div id="bloqueos" class="muted">Cargando…</div>
  </section>
  ` : ""}
  ${S.profile?.role === "admin" ? `
  <section class="card">
    <div class="row"><h2 style="margin:0">🧪 Estrategias que encontró el bot</h2><div class="spacer"></div></div>
    <p class="muted">Candidatas que el bot encontró y validó por su cuenta. <b>Ninguna opera hasta que la apruebes.</b></p>
    <div id="aiEstrategias" class="muted">Cargando…</div>
  </section>` : ""}
  <section class="card">
    <div class="row"><h2 style="margin:0">🔬 Agente investigador</h2><div class="spacer"></div>
      <button class="btn sm" id="researchNow">Investigar ahora</button></div>
    <p class="muted">Cada tarde (después del cierre) revive tus trades de los últimos 30 días vela a vela con las velas reales de 5M/15M/1H
    y prueba otros valores de stop loss y toma de ganancia. Solo cambia un ajuste si gana más en total <b>y</b> también en los trades
    antiguos y en los recientes; lo mueve un paso por día (máximo 2 ajustes) y necesita al menos 8 trades. Los límites de riesgo
    (pérdida diaria, tamaño, horarios) nunca los toca.</p>
    <div id="aiResearch" class="muted">Cargando…</div>
  </section>
  <section class="card">
    <div class="row"><h2 style="margin:0">📚 Agente historiador</h2><div class="spacer"></div>
      <button class="btn sm" id="patternsNow">Buscar patrones ahora</button></div>
    <p class="muted">Cada tarde revisa 1 año de velas de 1 hora, 2 años de velas diarias y 60 días de 15 minutos de cada activo,
    y anota los comportamientos que se repiten: a qué horas estira el movimiento y a cuáles lo devuelve, si los huecos de apertura
    se rellenan, qué pasa tras dos días seguidos en la misma dirección. El vigilante usa ese contexto mientras la posición está abierta:
    en las horas en las que el activo suele estirar deja correr más, y en las que suele devolver asegura antes.</p>
    <div id="aiPatterns" class="muted">Cargando…</div>
  </section>
  <section class="card"><h2>Lecciones recientes del analista</h2><div id="aiLessons"></div></section>`);
  bindEstrategias();
  bindResearch();
  bindPatterns();
  if (S.profile?.role === "admin") pintarIA();
  const lessons = S.trades.filter((t) => t.lesson).slice(0, 15);
  $("#aiLessons").innerHTML = lessons.length
    ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Activo</th><th>Setup</th><th class="num">P&L</th><th class="num">MFE</th><th class="num">Dejado</th><th>Lección</th></tr></thead><tbody>
    ${lessons.map((t) => `<tr><td>${etDay(t.opened_at)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(nombreSetup(t.setup))}</td>
      <td class="num ${cls(t.realized_pnl)}">${usd(t.realized_pnl)}</td><td class="num">+${(+t.mfe_r || 0).toFixed(2)}R</td>
      <td class="num">${t.left_on_table_r != null ? "+" + (+t.left_on_table_r).toFixed(2) + "R" : "—"}</td>
      <td style="white-space:normal;min-width:260px">${esc(t.lesson)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">Aún no hay trades analizados. El analista revisa cada cierre unos 45 minutos después.</div>`;
  loadRecomendaciones();
  if (DEMO) return ($("#aiStats").innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  const { data } = await sb.from("strategy_stats").select("*").order("n", { ascending: false });
  const titles = {
    setup: "Por setup", symbol: "Por activo", hour: "Por hora (NY)", align4h: "Alineación con 4H", direction: "CALL vs PUT",
    delta: "Por delta", spread: "Por spread", setup_symbol: "Setup × activo",
  };
  const groups = Object.keys(titles).map((dim) => [dim, (data ?? []).filter((r) => r.dimension === dim)]).filter(([, rows]) => rows.length);
  $("#aiStats").innerHTML = groups.length
    ? `<div class="grid cols-2">${groups.map(([dim, rows]) => `
    <div><h3>${titles[dim]}</h3><div class="table-wrap"><table><thead><tr><th>Grupo</th><th class="num">Trades</th><th class="num">Win</th><th class="num">P&L medio</th><th class="num">Dejado</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(nombreSetup(r.key, r.key.replace("|", " · ")))}</td><td class="num">${r.n}</td>
      <td class="num ${r.n >= 8 ? (r.win_rate >= 0.65 ? "pos" : r.win_rate < 0.4 ? "neg" : "") : "muted"}">${Math.round(r.win_rate * 100)}%</td>
      <td class="num ${cls(r.avg_pnl)}">${usd(r.avg_pnl)}</td><td class="num">${r.avg_left_r != null ? "+" + (+r.avg_left_r).toFixed(2) + "R" : "—"}</td></tr>`).join("")}
    </tbody></table></div></div>`).join("")}</div>`
    : `<div class="empty">Todavía no hay trades cerrados para aprender. Las estadísticas se actualizan cada día a las 16:20 NY.</div>`;
}

async function bindPaper() {
  const box = $("#paperAcct");
  if (DEMO) return box && (box.textContent = "Disponible al conectar Supabase");
  if ($("#paperEngine")) $("#paperEngine").onchange = async (e) => {
    await saveSettings({ paper_engine: e.target.value === "broker" ? "broker" : "internal" });
    toast("Motor del paper guardado (aplica a las entradas nuevas)");
  };
  $("#dataTokenSave").onclick = async () => {
    const token = $("#dataToken").value.trim();
    if (!token) return toast("Pega el token primero");
    try {
      const r = await action({ action: "save_data_token", token });
      $("#dataToken").value = "";
      if (r) toast(`Tiempo real conectado ✅ (SPY ${r.spy})`, 5000);
      await loadAll();
      render();
    } catch (err) { toast("Error: " + err.message, 7000); }
  };
  $("#dataTokenDel")?.addEventListener("click", async () => {
    if (!confirm("¿Quitar el token de datos? El paper volverá a precios retrasados.")) return;
    try { await action({ action: "delete_data_token" }); await loadAll(); render(); } catch (err) { toast(err.message); }
  });
  if ($("#paperReset")) $("#paperReset").onclick = async () => {
    const cash = Number($("#paperCash").value);
    if (!confirm(`¿Reiniciar la cuenta paper interna con ${usd(cash)}? Se borra su historial de órdenes (los trades del panel se conservan).`)) return;
    try { await action({ action: "paper_reset", cash }); toast("Cuenta paper reiniciada"); bindPaper(); } catch (err) { toast("Error: " + err.message, 6000); }
  };
  try {
    const r = await action({ action: "paper_account" });
    box.innerHTML = r?.cash == null ? "Se crea con tu primera operación (capital inicial = el de tu cuenta paper)"
      : `Efectivo <b>${usd(r.cash)}</b> · Capital <b>${usd(r.equity ?? r.cash)}</b> · Inicial ${usd(r.start)} · ` +
        `<span class="${cls((r.equity ?? r.cash) - r.start)}">${usd((r.equity ?? r.cash) - r.start)}</span>`;
  } catch { box.textContent = "—"; }
}

/** En qué punto está una estrategia que encontró el bot, mientras espera su decisión. */
const ESTADO_ESTRATEGIA = {
  pendiente: "⏳ Esperando tu decisión",
  activa: "🟢 Operando",
  descartada: "✖ Descartada",
  retirada: "⏸ Retirada",
};

async function bindEstrategias() {
  const box = $("#aiEstrategias");
  if (!box) return;
  if (DEMO) return (box.innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  const { data } = await sb.from("estrategias_descubiertas").select("*").order("creada_en", { ascending: false }).limit(20);
  if (!data?.length) {
    box.innerHTML = `<div class="empty">Todavía no ha encontrado ninguna que supere los tres filtros.</div>`;
    return;
  }
  box.innerHTML = data.map((e) => {
    const m = e.metricas ?? {};
    const v = m.validacion ?? null;
    const cond = (e.conds ?? []).map((c) => `<code>${esc(c.rasgo)} ${esc(c.op)} ${c.valor}</code>`).join(" y ");
    return `<div style="border-top:1px solid var(--line);padding:12px 0">
      <div class="row"><span class="badge ${e.dir === 'CALL' ? 'call' : 'put'}">${esc(e.dir)}</span>
        <b>Estrategia #${e.id}</b>
        <span class="badge">${ESTADO_ESTRATEGIA[e.estado] ?? esc(e.estado)}</span>
        <div class="spacer"></div><span class="muted sm">${etDay(e.creada_en)}</span></div>
      <div style="margin:8px 0">Entra cuando ${cond}</div>
      <div class="stats">
        <div><small>Donde se buscó</small><b>${m.n ?? "—"} ops · ${m.acierto ?? "—"}% · factor ${m.factor ?? "—"}</b></div>
        <div><small>1ª mitad / 2ª mitad</small><b>${m.r_1a_mitad ?? "—"}R / ${m.r_2a_mitad ?? "—"}R</b></div>
        <div><small>En activos NUEVOS</small><b class="${v && v.factor >= 1.2 ? 'pos' : 'neg'}">${v ? `${v.n} ops · factor ${v.factor} · ${v.r_total}R` : "sin validar"}</b></div>
      </div>
      ${e.estado === 'pendiente'
        ? `<div class="row" style="margin-top:10px;gap:8px">
            <button class="btn primary sm" data-estrat-si="${e.id}">✔ Aprobar y poner a operar</button>
            <button class="btn sm" data-estrat-no="${e.id}">✖ Descartar</button>
            <span class="muted sm">Hasta que pulses, no opera nada.</span></div>`
        : e.estado === 'activa'
        ? `<div class="row" style="margin-top:10px"><button class="btn danger sm" data-estrat-off="${e.id}">⏸ Retirar</button>
            <span class="muted sm">Lleva ${e.ops_reales ?? 0} operaciones reales (${usd(e.pnl_real ?? 0)}).</span></div>`
        : ""}
    </div>`;
  }).join("");

  const decidir = async (b, accion, id, pregunta) => {
    if (pregunta && !confirm(pregunta)) return;
    b.disabled = true;
    b.textContent = "…";
    try {
      await action({ action: accion, id });
      toast("Hecho");
      await bindEstrategias();
    } catch (err) {
      toast("Error: " + err.message, 6000);
      b.disabled = false;
    }
  };
  box.querySelectorAll("[data-estrat-si]").forEach((b) => (b.onclick = () => decidir(b, "estrategia_activar", +b.dataset.estratSi,
    "Vas a poner esta estrategia a operar de verdad. El bot abrirá posiciones con ella cuando se cumplan sus condiciones. ¿Seguro?")));
  box.querySelectorAll("[data-estrat-no]").forEach((b) => (b.onclick = () => decidir(b, "estrategia_descartar", +b.dataset.estratNo, null)));
  box.querySelectorAll("[data-estrat-off]").forEach((b) => (b.onclick = () => decidir(b, "estrategia_retirar", +b.dataset.estratOff,
    "Esta estrategia dejará de abrir posiciones nuevas. Las que tenga abiertas las sigue gestionando el vigilante. ¿Seguro?")));
}

async function bindResearch() {
  const box = $("#aiResearch"), btn = $("#researchNow");
  if (DEMO) return (box.innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Investigando…";
    try {
      const { error } = await sb.functions.invoke("research", { body: {} });
      if (error) throw error;
      toast("Investigación terminada");
      await loadAll();
      await viewReports(box);
    } catch (err) { toast("Error: " + err.message, 6000); }
    btn.disabled = false;
    btn.textContent = "Investigar ahora";
  };
  await viewReports(box);
}

const ESTADO_INFORME = {
  pendiente: "⏳ Esperando tu decisión",
  aplicado: "✅ Aplicado",
  descartado: "✖ Descartado",
  caducado: "🕗 Caducado (simulador viejo)",
};

async function viewReports(box) {
  const { data } = await sb.from("research_reports").select("*").order("created_at", { ascending: false }).limit(7);
  if (!data?.length) return (box.innerHTML = `<div class="empty">Todavía no hay reportes. El primero sale hoy después del cierre, o pulsa "Investigar ahora".</div>`);
  box.innerHTML = data.map((r, k) => `
    <div style="border-top:1px solid var(--line);padding:10px 0">
      <div class="row"><b>${esc(r.day)}</b>
        <span class="badge">${r.n_trades} trades</span>
        <span class="badge">${ESTADO_INFORME[r.estado ?? (r.applied ? "aplicado" : "pendiente")] ?? esc(r.estado)}</span></div>
      <div class="stats" style="margin:6px 0">
        <div><small>Real</small><b class="${cls(r.actual_pnl)}">${usd(r.actual_pnl)}</b></div>
        <div><small>Simulado (ajustes previos)</small><b class="${cls(r.sim_before)}">${usd(r.sim_before)}</b></div>
        <div><small>Simulado (ajustes nuevos)</small><b class="${cls(r.sim_after)}">${usd(r.sim_after)}</b></div></div>
      ${(r.changes ?? []).map((c) => `<div class="alert info" style="margin:4px 0">⚙️ ${esc(c)}</div>`).join("")}
      ${(r.estado ?? (r.applied ? "aplicado" : "pendiente")) === "pendiente" && (r.changes ?? []).length
        ? `<div class="row" style="margin-top:8px;gap:8px">
            <button class="btn primary sm" data-aprobar="${r.id}">✔ Aprobar y aplicar</button>
            <button class="btn sm" data-descartar="${r.id}">✖ Descartar</button>
            <span class="muted sm">Nada cambia hasta que pulses uno de los dos.</span>
          </div>`
        : ""}
      ${k === 0 ? (r.findings?.notes ?? []).map((n) => `<div class="muted">• ${esc(n)}</div>`).join("") : ""}
    </div>`).join("");

  // Decidir sobre una propuesta: aplicar escribe los ajustes, descartar solo deja constancia.
  const decidir = async (b, accion, texto) => {
    const cambios = b.closest("div").parentElement.querySelectorAll(".alert.info");
    const lista = [...cambios].map((x) => x.textContent.trim()).join("\n");
    if (accion === "research_apply" && !confirm(`Vas a aplicar estos ajustes al bot:\n\n${lista}\n\n¿Seguro?`)) return;
    b.disabled = true;
    b.textContent = texto;
    try {
      await action({ action: accion, id: +b.dataset.aprobar || +b.dataset.descartar });
      toast(accion === "research_apply" ? "Ajustes aplicados" : "Propuesta descartada");
      await loadAll();
      await viewReports(box);
    } catch (err) {
      toast("Error: " + err.message, 6000);
      b.disabled = false;
    }
  };
  box.querySelectorAll("[data-aprobar]").forEach((b) => (b.onclick = () => decidir(b, "research_apply", "Aplicando…")));
  box.querySelectorAll("[data-descartar]").forEach((b) => (b.onclick = () => decidir(b, "research_dismiss", "Descartando…")));
}

/** Las fichas de las posiciones abiertas. Se repinta sola cuando se mueve el dinero. */
function listaPosHTML(open) {
  return open.length
    ? `<div class="grid cols-2">${open.map(posCard).join("")}</div>`
    : `<div class="card empty">No hay posiciones abiertas. Cuando las haya, el vigilante las revisa cada segundo y medio.</div>`;
}

function viewPositions(v) {
  const open = S.trades.filter((t) => t.status === "open");
  v.insertAdjacentHTML("beforeend", `
  <div class="row" style="margin-bottom:12px">
    <h2 style="margin:0">Posiciones abiertas (${open.length})</h2><div class="spacer"></div>
    ${open.length ? `<button class="btn danger" id="closeAll">🛑 Cerrar todo</button>` : ""}
  </div>
  <div id="listaPos">${listaPosHTML(open)}</div>
`);
  engancharCerrar(v);
  const ca = $("#closeAll");
  if (ca) ca.onclick = async () => {
    if (!confirm(`¿Cerrar TODAS las posiciones (${open.length}) ahora mismo?`)) return;
    ca.disabled = true;
    ca.textContent = "Cerrando…";
    try {
      const r = await action({ action: "close_all" });
      const ok = (r?.closed ?? []).filter((c) => c.sold > 0).length;
      toast(`Cerradas ${ok} de ${open.length} posiciones` + (ok < open.length ? ": revisa las que quedan" : ""), 8000);
    } catch (e) {
      toast("No se pudo cerrar: " + e.message, 8000);
    } finally {
      if (!DEMO) { await loadAll(); render(); }
    }
  };
}

function posCard(t) {
  // UNA SOLA FICHA PARA TODOS desde el 21/10/2026, por petición suya: la posición y su dinero.
  // El stop, el progreso en R, el agotamiento, las etapas y la bitácora del vigilante son la
  // forma de trabajar del bot, y en esta página estorban. La bitácora sigue en Historial.
  return posCardSimple(t);
}

/** La misma posición, contada sin enseñar cómo la gestiona el bot. */
function posCardSimple(t) {
  const d = t.direction === "CALL" ? 1 : -1;
  const pnl = +(t.unrealized_pnl ?? 0) + +t.realized_pnl;
  const puesto = +t.entry_price * 100 * +t.qty;
  const bid = +(t.last_option_bid ?? 0);
  return `<div class="card pos-card">
    <div class="head">
      <span class="sym">${esc(t.symbol)}</span>
      <span class="badge ${d > 0 ? 'call' : 'put'}">${t.direction}</span>
      <span class="muted mono">${esc(t.option_symbol)}</span>
      <div class="spacer"></div>
      <span class="num ${cls(pnl)}" style="font-size:18px;font-weight:700">${usd(pnl)}</span>
      <button class="btn danger sm" data-close="${t.id}">🛑 Cerrar ya</button>
    </div>
    <div class="stats">
      <div><small>Contratos</small><b class="num">${t.qty_open}/${t.qty}</b></div>
      <div><small>Compra → venta ahora</small><b class="num">${usd(t.entry_price)} → ${bid ? usd(bid) : "—"}</b></div>
      <div><small>Puesto</small><b class="num">${usd(puesto)}</b></div>
      <div><small>Resultado</small><b class="num ${cls(pnl)}">${puesto ? ((pnl / puesto) * 100).toFixed(1) + "%" : "—"}</b></div>
    </div>
    <div class="muted" style="font-size:12px">Vence ${esc(t.expiry)} · el bot la está gestionando y la cerrará solo.</div>
  </div>`;
}

async function closeTrade(id) {
  const t = S.trades.find((x) => x.id === id);
  if (!confirm(`¿Cerrar YA ${t ? `${t.qty_open} contrato(s) de ${t.symbol} (${t.option_symbol})` : "esta posición"}?\nSe vende al precio de mercado disponible.`)) return;
  const btns = document.querySelectorAll(`[data-close="${id}"]`);
  btns.forEach((b) => { b.disabled = true; b.textContent = "Cerrando…"; });
  try {
    const r = await action({ action: "close_trade", trade_id: id });
    const sold = r?.closed?.[0]?.sold ?? 0;
    toast(sold > 0 ? `Cerrada: se vendieron ${sold} contrato(s)` : "El broker no llenó la venta. Revisa la bitácora del vigilante y vuelve a intentar.", 7000);
  } catch (e) {
    toast("No se pudo cerrar: " + e.message, 8000);
  } finally {
    if (!DEMO) { await loadAll(); render(); }
  }
}

// El historial enseña TODO, sin corte: es el expediente del bot y de él aprenden los agentes.
function viewHistory(v) {
  const days = [...new Set(S.trades.map((t) => etDay(t.opened_at)))];
  v.insertAdjacentHTML("beforeend", `
  <div class="card">
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0">Historial</h2><div class="spacer"></div>
      <select id="dayFilter" style="width:auto"><option value="">Todos los días</option>${days.map((d) => `<option>${d}</option>`).join("")}</select>
    </div>
    <div id="histSummary" class="muted" style="margin-bottom:8px"></div>
    <div id="histTable"></div>
  </div>`);
  const draw = () => {
    const day = $("#dayFilter").value;
    const rows = S.trades.filter((t) => !day || etDay(t.opened_at) === day);
    const k = computeStats(rows);
    $("#histSummary").innerHTML = `${rows.length} trades · win rate ${k.winRate == null ? "—" : k.winRate.toFixed(0) + "%"} · P&L <span class="${cls(k.total)}">${usd(k.total)}</span>`;
    $("#histTable").innerHTML = tradesTable(rows);
    bindTradeRows($("#histTable"));
  };
  $("#dayFilter").onchange = draw;
  draw();
}

function viewSignals(v) {
  v.insertAdjacentHTML("beforeend", `
  <div class="card">
    <h2>Señales detectadas</h2>
    <p class="muted">El scanner revisa tus activos 1 minuto después de cada cierre de vela de 15M. Solo se opera si el score ≥ tu mínimo (${S.settings?.min_score}).</p>
    ${S.signals.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Hora (NY)</th><th>Activo</th><th>Dirección</th><th>Setup</th><th class="num">Score</th><th class="num">Precio</th><th class="num">Stop</th><th class="num">Objetivo</th><th>4H / 1H</th><th>Decisión del bot</th><th>Motivos</th></tr></thead>
      <tbody>${S.signals.map((s) => `<tr>
        <td>${etDay(s.bar_time).slice(5)} ${etTime(s.bar_time)}</td><td><b>${esc(s.symbol)}</b></td>
        <td><span class="badge ${s.direction === "CALL" ? "call" : "put"}">${s.direction}</span></td>
        <td>${esc(nombreSetup(s.setup))}</td>
        <td class="num ${s.score >= (S.settings?.min_score ?? 60) ? "pos" : "muted"}">${s.score}</td>
        <td class="num">${(+s.price).toFixed(2)}</td><td class="num">${(+s.stop).toFixed(2)}</td><td class="num">${s.target ? (+s.target).toFixed(2) : "—"}</td>
        <td>${esc(s.bias_4h)} / ${esc(s.bias_1h)}</td>
        <td style="white-space:normal;min-width:200px" class="${/^ENTRÓ/.test(s.decision ?? "") ? "pos" : "muted"}">${esc(s.decision ?? "—")}</td>
        <td class="muted" style="white-space:normal;min-width:240px">${esc((s.reasons ?? []).join(" · "))}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Sin señales todavía</div>`}
  </div>`);
}

// LOS VALORES PREDETERMINADOS VIVEN EN LA BASE, en `predeterminados`, y solo los lee el admin.
// No son numeros de catalogo: cada uno gano en una medicion con datos reales y llevaba la
// medicion escrita al lado. Eso, en un fichero que se descarga sin cuenta, es el bot entero.

function viewConfig(v) {
  const isAdmin = S.profile?.role === "admin";
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

  ${isAdmin ? `
  <section class="card">
    <h2>🧪 Paper con precios reales</h2>
    <p class="muted">El <b>paper interno</b> simula tu cuenta dentro del bot: cada compra a mercado se llena al <b>ask real</b> y cada venta
    al <b>bid real</b> del momento, con un pequeño deslizamiento y la comisión de Tradier ($0.35 por contrato), como con dinero real.
    Para precios en <b>tiempo real</b> pega el token de tu cuenta <b>real</b> de Tradier (Tradier → Settings → API Access → token de producción).
    Ese token solo se usa para <b>leer precios</b>: el bot nunca manda órdenes con él. Sin token usa los precios del sandbox (15 min tarde).</p>
    <div class="form">
      ${isAdmin ? `<div><label>Motor del paper (entradas nuevas)</label><select id="paperEngine">
        <option value="internal" ${(s.paper_engine ?? "internal") === "internal" ? "selected" : ""}>Paper interno (llenados simulados con precios reales)</option>
        <option value="broker" ${s.paper_engine === "broker" ? "selected" : ""}>Sandbox de Tradier (precios 15 min tarde)</option></select></div>` : ""}
      <div><label>Precios</label><div>${s.has_realtime ? `<span class="badge">✅ Tiempo real (Tradier producción)</span>` : `<span class="badge">⚠️ Retrasados 15 min (sandbox)</span>`}</div></div>
      <div style="grid-column:1/-1"><label>Token de datos de Tradier (producción, solo lectura de precios)</label>
        <div class="row"><input id="dataToken" type="password" class="mono" autocomplete="off" placeholder="${s.has_realtime ? "Guardado ✓ — pega otro para cambiarlo" : "Pega aquí tu token de producción"}" style="max-width:360px">
        <button type="button" class="btn sm" id="dataTokenSave">Guardar token</button>
        ${s.has_realtime ? `<button type="button" class="btn sm danger" id="dataTokenDel">Quitar</button>` : ""}</div></div>
      <div><label>Cuenta paper interna</label><div id="paperAcct" class="muted">Cargando…</div></div>
      ${isAdmin ? `<div><label>Reiniciar con capital (US$)</label><div class="row"><input id="paperCash" type="number" min="1000" step="1000" value="100000" style="max-width:160px">
        <button type="button" class="btn sm danger" id="paperReset">Reiniciar paper</button></div></div>` : ""}
    </div>
  </section>` : ""}

${isAdmin && !Object.keys(S.textos).length ? `
  <section class="card"><div class="alert error">No se pudieron cargar los textos del panel:
    los campos salen con su nombre interno. <b>Puedes mirarlos, pero no guardes a ciegas.</b></div></section>` : ""}
${isAdmin ? `
  <section class="card">
    <h2>${tx("ti_1")}</h2>
    <form id="riskForm" class="form">
      <!-- SOLO LO QUE DE VERDAD SE MUEVE. Peticion suya del 24/10/2026, con su motivo:
           *"tener todas esas configuraciones ahi se presta para que en algun momento se muevan y
           algo empiece a funcionar mal descuidadamente"*. Y tenia razon: ese mismo dia
           descubrimos que guardar este formulario apagaba el Bot Familiar entero.

           Habia 64 campos. Quedan tres y las estrategias. El resto NO desaparece: sigue en la
           base con el valor que gano midiendo, y se cambia por migracion —con los numeros al
           lado— en vez de por un desplegable que se toca sin querer un martes.

           EL TOPE DE CONTRATOS BAJA DE 500 A 20. Nadie va a comprar 500 contratos a proposito;
           quinientos es la cifra que sale de un dedo resbalado. -->
      ${num("max_contracts", s.max_contracts, 1, 20, 1)}
      ${num("alloc_pct", s.alloc_pct, 0.5, 50, 0.5)}
      <div><label>${tx("et_trade_style")}</label><select name="trade_style"><option value="familiar" ${(s.trade_style ?? "familiar") === "familiar" ? "selected" : ""}>${tx("op_familiar_20")}</option><option value="scalp" ${s.trade_style === "scalp" ? "selected" : ""}>${tx("op_scalp_18")}</option><option value="swing" ${s.trade_style === "swing" ? "selected" : ""}>${tx("op_swing_19")}</option></select></div>
      <div style="grid-column:1/-1"><label>${tx("et_1")}</label>
        <p class="muted sm" style="margin:2px 0 8px">Marcada = el bot la busca en cada vela. Son las ${setupsElegibles().length} que sabe detectar; las que encuentra él solo se aprueban en Inteligencia, no aquí.</p>
        ${gruposSetups().length ? gruposSetups().map(([titulo, claves]) => `
          <div class="setup-grupo">
            <div class="setup-grupo-tit">${esc(titulo)}</div>
            ${claves.map((k) => `
              <label class="check setup-chk" title="${esc(queEsSetup(k))}">
                <input type="checkbox" name="setup" value="${k}" ${(s.setups ?? []).includes(k) ? "checked" : ""}>
                <span><b>${esc(nombreSetup(k))}</b><span class="setup-que">${esc(queEsSetup(k))}</span></span>
              </label>`).join("")}
          </div>`).join("") : `<div class="alert error">No se pudo cargar el catálogo de estrategias.
            <b>No guardes este formulario</b>: se escribiría la lista vacía y el bot dejaría de buscar.</div>`}
      </div>
      <div style="grid-column:1/-1" class="row">
        <button class="btn primary">Guardar</button>
        <button type="button" class="btn" id="resetPredeterminados" title="Devuelve cada ajuste a su valor predeterminado, el que gano midiendo con datos reales. No guarda: los marca para que los revises.">↩︎ Valores predeterminados</button>
        <span class="muted sm">Devuelve los ajustes a sus valores predeterminados, los que ganaron midiendo con datos reales. Marca en naranja los que cambia y no guarda nada hasta que pulses Guardar.</span>
      </div>
    </form>
  </section>

  <section class="card">
    <h2>${tx("ti_2")}</h2>
    <p class="muted">${tx("ay_1")}</p>
    <form id="watchForm" class="row" style="margin-bottom:12px">
      <input name="symbol" placeholder="Ej: AAPL" style="max-width:160px;text-transform:uppercase" required pattern="[A-Za-z.\\-]{1,10}">
      <button class="btn">Agregar</button>
    </form>
    <div class="row">${S.watch.map((w) => `
      <span class="badge" style="padding:6px 10px;font-size:13px;${w.active ? "" : "opacity:.45"}">
        <a href="#" data-wtoggle="${w.id}" style="color:inherit;text-decoration:none" title="Activar/pausar">${esc(w.symbol)}</a>
        <a href="#" data-wdel="${w.id}" class="muted" style="margin-left:6px;text-decoration:none" title="Quitar">×</a>
      </span>`).join("") || `<span class="muted">Lista vacía</span>`}</div>
  </section>` : `
  `}`);

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

  const btnPredeterminados = $("#resetPredeterminados");
  if (btnPredeterminados) btnPredeterminados.onclick = () => {
    const f = $("#riskForm");
    // Si el diccionario no llego, el boton no toca nada: poner valores a medias en un formulario
    // de riesgo y guardarlo es peor que no poder pulsarlo.
    if (!Object.keys(S.predeterminados).length) {
      return toast("No se pudieron cargar los valores predeterminados. No se ha tocado nada.", 6000);
    }
    let cambiados = 0;
    for (const [k, valor] of Object.entries(S.predeterminados)) {
      const campo = f.elements[k];
      if (!campo) continue;
      if (Number(campo.value) !== valor) {
        campo.value = valor;
        campo.style.outline = "2px solid var(--warn, #f59e0b)";
        cambiados++;
      }
    }
    toast(
      cambiados
        ? `${cambiados} ajuste(s) devueltos a su valor predeterminado (marcados en naranja). Revisa y pulsa Guardar.`
        : "Ya estaban todos en su valor predeterminado.",
      9000,
    );
  };

  if (isAdmin) $("#riskForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    // SOLO SE ESCRIBE LO QUE EL FORMULARIO ENSEÑA. Esta es la otra mitad del recorte del 24/10, y
    // la peligrosa: antes el guardado recorria una lista fija de 52 claves con
    // `patch[k] = Number(fd.get(k))`. Para un campo que ya NO esta en el formulario, `fd.get`
    // devuelve null y `Number(null)` es 0 — el primer guardado habria dejado el delta en 0, el stop
    // en 0 y los vencimientos en 0. Quitar los campos sin tocar esto habria sido mucho peor que
    // dejarlos. Ahora, si un campo no viene, NO SE TOCA.
    const patch = {};
    for (const k of ["max_contracts", "alloc_pct"]) {
      const v = fd.get(k);
      if (v === null || v === "") continue;
      const n = Number(v);
      if (!Number.isFinite(n)) return toast(`Revisa el campo ${k}`);
      patch[k] = n;
    }
    // NUNCA DEGRADAR EL ESTANDAR POR OMISION. Antes esto era `=== "swing" ? "swing" : "scalp"`, o
    // sea: cualquier cosa que no fuera "swing" acababa en "scalp". Y "scalp" apaga el Bot Familiar
    // entero —es la unica bifurcacion que lo enciende— sin devolver ningun error.
    // Ahora solo pasan los tres valores conocidos, y si el campo no llega o trae otra cosa se queda
    // COMO ESTABA. Un formulario no puede cambiar de motor por descuido.
    const estilo = String(fd.get("trade_style") ?? "");
    patch.trade_style = ["familiar", "scalp", "swing"].includes(estilo) ? estilo : (s.trade_style ?? "familiar");
    // Se conserva lo que NO es casilla (las que el bot descubrio solo): el formulario no las
    // gobierna, asi que guardar aqui no puede borrarlas.
    const noElegibles = (s.setups ?? []).filter((k) => !setupsElegibles().includes(k));
    const marcadas = fd.getAll("setup");
    // DOS FRENOS QUE ANTES SOLO ERAN UN AVISO EN TEXTO. Si el catalogo no cargo, el formulario
    // enseñaba un aviso en rojo... y te dejaba guardar igual la lista vacia, con lo que el bot
    // dejaba de buscar nada. Ahora no guarda.
    if (!gruposSetups().length) return toast("No se cargó el catálogo de estrategias: no se ha guardado nada.", 7000);
    if (!marcadas.length && !noElegibles.length) return toast("Marca al menos una estrategia: sin ninguna, el bot no busca nada.", 7000);
    patch.setups = [...marcadas, ...noElegibles];
    await saveSettings(patch);
    toast("Configuración guardada");
  };

  bindPaper();

  if (isAdmin) $("#watchForm").onsubmit = async (e) => {
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

/** Un campo numerico del formulario. La etiqueta no viaja en este fichero: se pide por clave. */
function num(name, value, min, max, step) {
  return `<div><label>${tx(name)}</label><input type="number" name="${name}" value="${value ?? ""}" min="${min}" max="${max}" step="${step}" required></div>`;
}

async function bindInvites() {
  const panelUrl = location.origin + location.pathname;
  const list = async () => {
    const { data, error } = await sb.rpc("list_invitations");
    if (error) return ($("#invites").textContent = error.message);
    const label = { pendiente: "⏳ Pendiente", enviada: "📨 Enviada", aceptada: "✅ Ya entró" };
    $("#invites").innerHTML = data?.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Email</th><th>Rol</th><th>Fecha</th><th>Estado</th><th>Correo</th><th></th></tr></thead>
      <tbody>${data.map((i) => `<tr><td><b>${esc(i.email)}</b></td><td>${esc(i.role)}</td><td>${etDay(i.created_at)}</td>
        <td>${label[i.status] ?? esc(i.status)}</td>
        <td>${i.emailed ? "✓ enviado" : `<span class="muted" title="${esc(i.note ?? "")}">manual</span>`}</td>
        <td><button class="btn sm danger" data-revoke="${esc(i.email)}">Revocar</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Todavía no hay invitaciones.</div>`;
    $("#invites").querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`¿Revocar la invitación de ${b.dataset.revoke}? Si ya entró, pierde el acceso.`)) return;
      try { await action({ action: "revoke_invite", email: b.dataset.revoke }); toast("Invitación revocada"); list(); } catch (err) { toast(err.message); }
    }));
  };
  $("#inviteForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const r = await action({ action: "invite_user", email: f.email, role: f.role, redirect: panelUrl });
      if (!r) return;
      e.target.reset();
      if (r.existed) toast("Ese email ya tenía cuenta: quedó aprobado", 5000);
      else if (r.emailed) toast("Invitación enviada por email ✅", 5000);
      if (r.link) {
        const msg = `Te invito a True TraderX. Entra aquí para crear tu contraseña: ${r.link}`;
        $("#inviteLink").innerHTML = `<div class="alert info" style="margin-bottom:12px">El correo automático no salió
          (${esc(r.error ?? "límite del servicio de email")}). Envíale este enlace tú mismo (es personal, válido 24 h):
          <div class="row" style="margin-top:8px"><input class="mono" readonly value="${esc(r.link)}" style="flex:1">
          <button type="button" class="btn sm" id="copyInvite">Copiar mensaje</button></div></div>`;
        $("#copyInvite").onclick = async () => { await navigator.clipboard.writeText(msg); toast("Mensaje copiado"); };
      } else $("#inviteLink").innerHTML = "";
      list();
    } catch (err) { toast("Error: " + err.message, 7000); }
    btn.disabled = false;
  };
  list();
}

/**
 * EL HISTORIAL DIARIO DE LAS POSICIONES DE LOS USUARIOS. Peticion suya del 24/10/2026: *"quiero
 * que me permita ver el historial de posiciones diarias de los usuarios"*.
 *
 * DE DONDE SALEN LOS DATOS, y por que no hizo falta ninguna politica nueva: se lee
 * `mis_operaciones` SIN filtrar por usuario. Esa vista acaba en `where user_id = auth.uid() or
 * is_admin()`, asi que a un admin le devuelve las de todos y a un usuario solo las suyas. La tabla
 * `trades` por debajo tiene RLS de solo admin; la vista es la que deja a cada usuario ver lo suyo.
 * Si alguien quita ese `where`, este panel pasa a enseñar el dinero de todo el mundo a cualquiera.
 *
 * Y SE PINTA CON `tradesTable`, la misma de Historial, tambien a proposito: el 21/10 se quito de
 * las tablas el contrato, la cantidad y el motivo de salida —incluso para el admin— porque son la
 * receta del bot y este fichero se descarga sin cuenta. Una pantalla nueva no es excusa para
 * devolverlos.
 *
 * El resumen por dia va ARRIBA y el detalle abajo: lo que el pidio es ver la forma de cada jornada
 * de un vistazo, y la lista de operaciones sueltas no la enseña.
 */
function pintarHistorialUsuarios(users, ops) {
  const nombre = (id) => {
    const u = (users ?? []).find((x) => x.id === id);
    return u ? (u.full_name || u.email || id.slice(0, 8)) : id.slice(0, 8);
  };
  if (!ops.length) {
    $("#histUsuarios").innerHTML = `<div class="empty">Todavía no hay operaciones de ningún usuario.</div>`;
    return;
  }
  const dias = [...new Set(ops.map((t) => etDay(t.opened_at)))].sort().reverse();
  const quienes = [...new Set(ops.map((t) => t.user_id))];
  $("#histUsuarios").innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <select id="huUser" style="width:auto"><option value="">Todos los usuarios</option>${quienes.map((id) => `<option value="${esc(id)}">${esc(nombre(id))}</option>`).join("")}</select>
      <select id="huDay" style="width:auto"><option value="">Todos los días</option>${dias.map((d) => `<option>${d}</option>`).join("")}</select>
      <div class="spacer"></div><div id="huResumen" class="muted"></div>
    </div>
    <div id="huPorDia" style="margin-bottom:12px"></div>
    <div id="huTabla"></div>`;
  const draw = () => {
    const uid = $("#huUser").value, day = $("#huDay").value;
    const rows = ops.filter((t) => (!uid || t.user_id === uid) && (!day || etDay(t.opened_at) === day));
    const k = computeStats(rows);
    // Una posicion abierta suma su flotante: es dinero vivo, igual que en el resto del panel. Y el
    // total de arriba se calcula IGUAL que la tabla de abajo a proposito: `computeStats().total`
    // solo cuenta lo cerrado, asi que usarlo aqui dejaria dos cifras que deberian cuadrar y no
    // cuadran en cuanto haya una posicion abierta.
    const vivo = (t) => +t.realized_pnl + (t.status === "open" ? +(t.unrealized_pnl ?? 0) : 0);
    const total = rows.reduce((s, t) => s + vivo(t), 0);
    $("#huResumen").innerHTML = `${rows.length} operaciones · acierto ${k.winRate == null ? "—" : k.winRate.toFixed(0) + "%"} · P&L <span class="${cls(total)}">${usd(total)}</span>`;
    const porDia = {};
    for (const t of rows) {
      const d = (porDia[etDay(t.opened_at)] ??= { n: 0, pnl: 0, ganadas: 0, cerradas: 0, abiertas: 0 });
      d.n++;
      d.pnl += vivo(t);
      if (t.status === "open") d.abiertas++;
      else { d.cerradas++; if (+t.realized_pnl > 0) d.ganadas++; }
    }
    const dd = Object.keys(porDia).sort().reverse();
    $("#huPorDia").innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Día (NY)</th><th class="num">Operaciones</th><th class="num">Abiertas</th><th class="num">Acierto</th><th class="num">P&L</th></tr></thead>
      <tbody>${dd.map((d) => {
        const x = porDia[d];
        return `<tr><td>${d}</td><td class="num">${x.n}</td>
          <td class="num ${x.abiertas ? "" : "muted"}">${x.abiertas || "—"}</td>
          <td class="num">${x.cerradas ? Math.round((100 * x.ganadas) / x.cerradas) + "%" : "—"}</td>
          <td class="num ${cls(x.pnl)}"><b>${usd(x.pnl)}</b></td></tr>`;
      }).join("")}</tbody></table></div>`;
    $("#huTabla").innerHTML = tradesTable(rows);
    bindTradeRows($("#huTabla"));
  };
  $("#huUser").onchange = draw;
  $("#huDay").onchange = draw;
  draw();
}

/**
 * PULSAR UN USUARIO ABRE SU HISTORIAL. Peticion suya del 24/10/2026: *"al darle click a cada
 * usuario en el panel de admin pueda ver no solo su cuenta sino tambien su historial de trading"*.
 *
 * Se ignoran los clics sobre el selector de rol y el interruptor de aprobado, que viven dentro de
 * la misma fila: tocar uno de esos no es querer abrir el historial, y sin esta guarda cambiar un
 * rol te saltaria la pantalla a otro sitio.
 */
function bindFilasUsuario(v) {
  v.querySelectorAll("[data-user]").forEach((fila) => (fila.onclick = (e) => {
    if (e.target.closest("select,input,label,button,a")) return;
    const sel = $("#huUser");
    if (!sel) return;
    sel.value = fila.dataset.user;
    // Si el usuario no tiene ni una operacion no esta en el desplegable, y asignar deja el valor
    // en blanco: se avisa en vez de enseñar las de todos como si fueran suyas.
    if (sel.value !== fila.dataset.user) return toast("Ese usuario todavía no tiene operaciones");
    sel.onchange();
    $("#histUsuarios").closest("section").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

async function viewAdmin(v) {
  v.insertAdjacentHTML("beforeend", `<section class="card"><h2>✉️ Invitar usuarios</h2>
    <p class="muted">Escribe el email: le llega una invitación, crea su contraseña y entra <b>ya aprobado</b>. Si el correo no sale
    (límite del servicio de email), aquí aparece el enlace para que se lo mandes tú por WhatsApp o email.</p>
    <form id="inviteForm" class="row" style="margin-bottom:12px">
      <input name="email" type="email" required placeholder="correo@ejemplo.com" style="max-width:280px">
      <select name="role" style="width:auto"><option value="user">Usuario</option><option value="admin">Administrador</option></select>
      <button class="btn primary">Enviar invitación</button>
    </form>
    <div id="inviteLink"></div>
    <div id="invites" class="muted">Cargando…</div></section>
  <section class="card"><h2>Usuarios</h2><div id="users" class="muted">Cargando…</div></section>
  <section class="card"><h2>Historial diario de posiciones</h2>
    <p class="muted">Las operaciones de cada usuario, día a día. Pulsa un usuario en la tabla de arriba, o elígelo aquí.</p>
    <div id="histUsuarios" class="muted">Cargando…</div></section>
  <section class="card"><h2>Alertas de seguridad y errores</h2><div id="alerts" class="muted">Cargando…</div></section>
  <section class="card"><h2>Salud del bot</h2><div id="runs" class="muted">Cargando…</div></section>`);
  if (DEMO) {
    for (const id of ["#users", "#histUsuarios", "#alerts", "#runs"]) $(id).innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`;
    return;
  }
  viewAlerts();
  bindInvites();
  const [{ data: users }, { data: trades }, { data: settings }, { data: runs }, { data: ops }] = await Promise.all([
    sb.from("profiles").select("*").order("created_at"),
    sb.from("trades").select("user_id, status, realized_pnl, unrealized_pnl").limit(10000),
    sb.from("bot_settings").select("user_id, enabled, mode, has_keys, last_equity, last_error"),
    sb.from("bot_runs").select("*").order("ts", { ascending: false }).limit(40),
    // SIN filtrar por usuario, a proposito: `mis_operaciones` ya decide quien ve que. Ver la nota
    // en pintarHistorialUsuarios().
    sb.from("mis_operaciones").select("*").order("opened_at", { ascending: false }).limit(2000),
  ]);
  pintarHistorialUsuarios(users, ops ?? []);
  $("#users").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Usuario</th><th>Rol</th><th>Aprobado</th><th>Bot</th><th>Cuenta</th><th class="num">Capital</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">P&L</th><th>Último error</th></tr></thead>
    <tbody>${(users ?? []).map((u) => {
      const st = settings?.find((s) => s.user_id === u.id) ?? {};
      const k = computeStats((trades ?? []).filter((t) => t.user_id === u.id).map((t) => ({ ...t, opened_at: new Date().toISOString() })));
      return `<tr class="clickable" data-user="${esc(u.id)}" title="Pulsa para ver su historial de operaciones">
        <td><b>${esc(u.full_name)}</b><br><span class="muted">${esc(u.email)}</span></td>
        <td><select data-role="${u.id}" style="width:auto" ${u.id === S.user.id ? "disabled" : ""}><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option></select></td>
        <td><label class="switch"><input type="checkbox" data-approve="${u.id}" ${u.approved ? "checked" : ""} ${u.id === S.user.id ? "disabled" : ""}><span></span></label></td>
        <td>${st.enabled ? `<span class="pos">ON</span>` : `<span class="muted">OFF</span>`}</td>
        <td>${st.has_keys ? `<span class="badge ${st.mode === "live" ? "live" : "paper"}">${st.mode}</span>` : `<span class="muted">sin broker</span>`}</td>
        <td class="num">${usd(st.last_equity)}</td><td class="num">${k.closed + k.open}</td>
        <td class="num">${k.winRate == null ? "—" : k.winRate.toFixed(0) + "%"}</td><td class="num ${cls(k.total)}">${usd(k.total)}</td>
        <td class="muted" style="white-space:normal;max-width:260px">${esc(st.last_error ?? "")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  bindFilasUsuario(v);
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
  const reasons = ["Stop", "Toma de ganancia", "Cierre programado", "Toma de ganancia", "Stop"];
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
  return {
    profile: { role: "admin", approved: true, full_name: "Demo" },
    settings: {
      enabled: true, mode: "paper", broker: "alpaca", has_keys: true, key_hint: "…DEMO", last_equity: 25340.12, alloc_pct: 5, max_contracts: 10,
      max_open_positions: 3, max_trades_per_day: 0, daily_loss_limit_pct: 6, option_stop_pct: 40, delta_min: 0.55, delta_max: 0.7, partial_r: 0.5, dte_min: 5, dte_max: 10,
      max_spread_pct: 12, max_spread_usd: 10, order_type: "market", expiry_mode: "intraday", trade_style: "scalp", min_score: 60, close_eod: true, skip_lunch: true, setups: ["vela_maestra", "rebote_ema20", "iman", "momentum"],
    },
    trades,
    watch: syms.map((s, i) => ({ id: i + 1, symbol: s, active: true })),
    signals: [
      { bar_time: new Date(now - 50 * 60e3).toISOString(), symbol: "NVDA", direction: "CALL", setup: "vela_maestra", score: 78, price: 184.2, stop: 183.1, target: 186.4, bias_1h: "CALL", bias_4h: "CALL", reasons: ["señal de ejemplo"] },
      { bar_time: new Date(now - 35 * 60e3).toISOString(), symbol: "META", direction: "PUT", setup: "rebote_ema20", score: 55, price: 702.4, stop: 705.1, target: 695.2, bias_1h: "PUT", bias_4h: "LATERAL", reasons: ["señal de ejemplo"] },
    ],
  };
}

boot();

/**
 * Lo que el agente de aprendizaje PROPONE, y los bloqueos que el trader ya aprobó.
 *
 * El agente no escribe nunca en aprendizaje_bloqueos: ahí solo llega lo que se aprueba desde aquí.
 * Esa es toda la diferencia entre un agente que opina y uno que decide.
 */
async function loadRecomendaciones() {
  const caja = $("#recos");
  if (!caja) return;
  if (DEMO) return (caja.innerHTML = `<div class="empty">Disponible al conectar Supabase</div>`);
  const [{ data: recos }, { data: bloq }] = await Promise.all([
    sb.from("recomendaciones").select("*").eq("estado", "pendiente").order("creada_en", { ascending: false }).limit(30),
    sb.from("aprendizaje_bloqueos").select("*").order("creado_en", { ascending: false }).limit(30),
  ]);
  caja.innerHTML = (recos ?? []).length
    ? `<div class="table-wrap"><table>
      <thead><tr><th>Propuesta</th><th>Por qué</th><th class="num">Operaciones</th><th class="num">Acierto</th><th></th></tr></thead>
      <tbody>${recos.map((r) => `<tr>
        <td><b>${esc(r.titulo)}</b></td>
        <td style="white-space:normal;min-width:240px" class="muted">${esc(r.motivo)}</td>
        <td class="num">${r.evidencia?.n ?? "—"}</td>
        <td class="num">${r.evidencia?.win_rate != null ? Math.round(r.evidencia.win_rate * 100) + "%" : "—"}</td>
        <td><button class="btn sm" data-reco-ok="${r.id}">Aplicar</button>
          <button class="btn sm ghost" data-reco-no="${r.id}">Descartar</button></td>
      </tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">Nada que proponer. El agente necesita 8 operaciones cerradas de un setup en un activo para opinar.</div>`;
  const cajaB = $("#bloqueos");
  if (cajaB) {
    cajaB.innerHTML = (bloq ?? []).length
      ? `<div class="table-wrap"><table><thead><tr><th>Setup</th><th>Activo</th><th>Motivo</th><th></th></tr></thead>
        <tbody>${bloq.map((b) => `<tr><td>${esc(nombreSetup(b.setup))}</td><td><b>${esc(b.symbol)}</b></td>
          <td class="muted" style="white-space:normal">${esc(b.motivo)}</td>
          <td><button class="btn sm ghost" data-bloq-del="${b.id}">Quitar</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Ningún bloqueo aprobado.</div>`;
  }
  const pulsa = (sel, accion, aviso) =>
    document.querySelectorAll(sel).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        await action({ action: accion, id: +b.dataset.recoOk || +b.dataset.recoNo || +b.dataset.bloqDel });
        toast(aviso);
        loadRecomendaciones();
      } catch (e) { b.disabled = false; toast(e.message); }
    }));
  pulsa("[data-reco-ok]", "recomendacion_aplicar", "Aplicada: el bot dejará de operar ese setup en ese activo");
  pulsa("[data-reco-no]", "recomendacion_descartar", "Descartada");
  pulsa("[data-bloq-del]", "bloqueo_quitar", "Bloqueo quitado: el bot vuelve a poder operarlo");
}


// =============================================================================================
// EL APARTADO DE LAS CLAVES DE IA (19/10/2026)
//
// Su encargo: "agrega el apartado para agregar los api manualmente y que sea para al menos 4
// inteligencias las que esten gratuitas".
//
// CUATRO GRATUITAS Y DOS DE PAGO. La lista la manda el servidor, con lo que cada una da gratis
// y donde se saca la clave, para que no haya que buscarlo.
//
// LA CLAVE SE ESCRIBE UNA VEZ Y NO VUELVE. Se manda, se cifra en el servidor y lo unico que se
// ve despues son los cuatro ultimos caracteres. El campo se vacia al guardar: si se pudiera leer
// de vuelta, no estaria a salvo.
//
// Y SE PRUEBA ANTES DE GUARDAR: si la clave no responde, no se guarda. Asi no queda una clave
// rota esperando a fallar con dinero de por medio.
// =============================================================================================
async function pintarIA() {
  const caja = $("#iaPanel");
  if (!caja) return;
  let d;
  try {
    d = await action({ action: "ia_proveedores" });
  } catch (e) {
    caja.innerHTML = `<span class="bad">No se pudo cargar: ${esc(e.message)}</span>`;
    return;
  }
  const a = d?.ajustes ?? {};
  const enUso = a.ia_proveedor ?? null;
  // TRES MODOS, no un interruptor: 0 apagada, 1 SOLO OBSERVA, 2 actua. El 1 es el que permite
  // medir si aporta antes de darle el boton, comparando lo que habria hecho con lo que hizo el bot.
  const modo = Number(a.ia_modo ?? 0);
  const encendida = modo > 0;
  const valida = Number(a.ia_valida_entradas ?? 0) > 0;
  // Con que haya UNA clave guardada ya se puede preparar todo: las instrucciones, los permisos
  // y los modos. Encenderla es el ultimo paso, no el primero.
  const hayClave = d.proveedores.some((p) => p.configurado);

  const fila = (p) => `
    <div class="card" style="margin:0 0 10px" data-ia="${p.id}">
      <div class="row">
        <b>${esc(p.nombre)}</b>
        ${p.gratis ? `<span class="badge">GRATIS</span>` : `<span class="badge">de pago</span>`}
        ${p.imagenes ? "" : `<span class="badge" title="Su plan gratuito no admite imágenes">solo texto</span>`}
        ${enUso === p.id && encendida ? `<span class="badge live">EN USO</span>` : ""}
        <div class="spacer"></div>
        ${p.configurado ? `<span class="mono muted" title="Los cuatro últimos caracteres de la clave guardada">${esc(p.pista ?? "")}</span>` : ""}
      </div>
      <p class="muted" style="margin:4px 0">Gratis: ${esc(p.limite)} · <a href="${esc(p.donde)}" target="_blank" rel="noopener">sacar la clave aquí</a></p>
      ${p.aviso ? `<p class="muted" style="margin:4px 0"><i>${esc(p.aviso)}</i></p>` : ""}
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <input type="password" class="mono" style="flex:2;min-width:200px" autocomplete="new-password"
               placeholder="${p.configurado ? "Pega una clave nueva para reemplazarla" : "Pega aquí tu clave de API"}" data-clave="${p.id}">
        <input type="text" class="mono" style="flex:1;min-width:150px" placeholder="modelo"
               value="${esc(p.modelo ?? p.modeloPorDefecto)}" data-modelo="${p.id}">
        <button class="btn sm" data-guardar="${p.id}">Guardar</button>
        ${p.configurado ? `<button class="btn sm" data-probar="${p.id}">Probar</button>` : ""}
        ${p.configurado && !(enUso === p.id && encendida) ? `<button class="btn sm" data-usar="${p.id}">Usar esta</button>` : ""}
        ${p.configurado ? `<button class="btn sm" data-borrar="${p.id}">Borrar</button>` : ""}
      </div>
      <div class="muted" data-res="${p.id}" style="margin-top:6px"></div>
    </div>`;

  const gratis = d.proveedores.filter((p) => p.gratis);
  const pago = d.proveedores.filter((p) => !p.gratis);
  caja.innerHTML = `
    <div class="card" style="margin:0 0 12px;border:1px solid var(--line)">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b style="font-size:1.05em">La IA está:</b>
        ${modo === 2
          ? `<span class="badge live">ACTUANDO</span>`
          : modo === 1
          ? `<span class="badge">SOLO OBSERVANDO</span>`
          : `<span class="badge">APAGADA</span>`}
        ${enUso ? `<span class="muted">con ${esc(enUso)}</span>` : ""}
      </div>
      <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn ${modo === 0 ? "" : "sm"}" data-modo="0" ${modo === 0 ? "disabled" : ""}>Apagada</button>
        <button class="btn ${modo === 1 ? "" : "sm"}" data-modo="1" ${modo === 1 ? "disabled" : ""}>Solo observar</button>
        <button class="btn ${modo === 2 ? "" : "sm"}" data-modo="2" ${modo === 2 ? "disabled" : ""}>Actuar</button>
        <div class="spacer"></div>
        <label class="muted">IA en uso:
          <select id="iaCual" ${hayClave ? "" : "disabled"}>
            ${d.proveedores.filter((p) => p.configurado).map((p) =>
              `<option value="${p.id}" ${enUso === p.id ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}
            ${hayClave ? "" : `<option>— guarda una clave primero —</option>`}
          </select></label>
      </div>
      <p class="muted" style="margin:8px 0 0">
        <b>Apagada:</b> no se hace ni una llamada. ·
        <b>Solo observar:</b> opina y queda registrado, pero no toca nada. ·
        <b>Actuar:</b> cierra, extiende y puede vetar entradas.</p>
    </div>

    <div class="row" style="margin-bottom:10px">
      <div class="spacer"></div>
      <label class="muted">Confianza mínima
        <input type="number" min="0" max="100" style="width:70px" id="iaConf" value="${Number(a.ia_confianza_min ?? 70)}">%</label>
      <label class="muted">Preguntar cada
        <input type="number" min="10" max="900" style="width:70px" id="iaCada" value="${Number(a.ia_cada_seg ?? 60)}">s</label>
    </div>

    ${hayClave ? `
    <div class="card" style="margin:0 0 12px">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <b>Dónde trabaja:</b>
        <label class="muted"><input type="checkbox" checked disabled> Posiciones abiertas
          <span class="muted">(validar, invalidar y afinar el objetivo)</span></label>
        <label class="muted"><input type="checkbox" id="iaEntradas" ${valida ? "checked" : ""}>
          <b>Entradas, antes de ejecutarlas</b></label>
        <div class="spacer"></div>
        <button class="btn sm" id="iaGuardarModo">Guardar</button>
      </div>
      <p class="muted" style="margin:8px 0 0">En las entradas la IA <b>solo puede vetar</b>: juzga las señales que
      encuentran tus estrategias y nunca propone una nueva. Es donde está el win rate — de tus operaciones perdidas,
      el <b>72% nunca estuvo en verde</b>: no se torcieron, nacieron mal.</p>
      <p class="muted" style="margin:6px 0 0">Déjala una semana en <b>solo observar</b> antes de darle el botón:
      así se puede mirar cuántas de las que habría cortado perdieron de verdad, sin arriesgar nada.</p>

      <div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap">
        <b>Qué más puede tocar:</b>
        <label class="muted"><input type="checkbox" id="iaContrato" ${Number(a.ia_elige_contrato ?? 0) ? "checked" : ""}>
          Elegir el contrato <span class="muted">(entre los que ya pasaron tus filtros)</span></label>
        <label class="muted"><input type="checkbox" id="iaStop" ${Number(a.ia_mueve_stop ?? 0) ? "checked" : ""}>
          Mover el stop <span class="muted">(<b>solo para apretarlo</b>, nunca para ampliarlo)</span></label>
        <label class="muted"><input type="checkbox" id="iaGrafico" ${Number(a.ia_ve_graficos ?? 0) ? "checked" : ""}>
          <b>Ver el gráfico dibujado</b> <span class="muted">(Gemini sí; Groq gratis no admite imágenes)</span></label>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="row"><b>📝 Las instrucciones que le das</b><div class="spacer"></div>
        <button class="btn sm" id="iaGuardarEncargos">Guardar instrucciones</button></div>
      <p class="muted" style="margin:4px 0 10px">Escribe aquí <b>cómo quieres que actúe</b>. Esto sustituye a las
      instrucciones de serie. Déjalo vacío para volver a las de serie.</p>
      <p class="muted" style="margin:4px 0 10px">Lo que escribas <b>no puede romper nada</b>: los datos del gráfico y
      el formato de la respuesta los pone siempre el bot, y los límites de la IA viven en el código, no en este texto.
      Aunque borres la línea del stop, la IA sigue sin poder cancelarlo.</p>

      <label class="muted"><b>Cuando juzga una ENTRADA</b> (antes de ejecutarla)</label>
      <textarea id="iaEncEntrada" rows="8" class="mono" style="width:100%;margin:4px 0 4px"
        placeholder="${esc((d.encargos?.entrada ?? "").slice(0, 400))}…">${esc(a.ia_encargo_entrada ?? "")}</textarea>
      <div class="row" style="margin-bottom:12px"><button class="btn sm" data-serie="entrada">Poner las de serie</button>
        <span class="muted">para empezar desde ellas y cambiarlas</span></div>

      <label class="muted"><b>Cuando mira una POSICIÓN ABIERTA</b></label>
      <textarea id="iaEncPosicion" rows="8" class="mono" style="width:100%;margin:4px 0 4px"
        placeholder="${esc((d.encargos?.posicion ?? "").slice(0, 400))}…">${esc(a.ia_encargo_posicion ?? "")}</textarea>
      <div class="row"><button class="btn sm" data-serie="posicion">Poner las de serie</button>
        <span class="muted">para empezar desde ellas y cambiarlas</span></div>
    </div>` : ""}
    <h3 style="margin:10px 0 6px">Gratuitas</h3>${gratis.map(fila).join("")}
    <h3 style="margin:14px 0 6px">De pago</h3>${pago.map(fila).join("")}
    <p class="muted" style="margin-top:10px">Los límites de las capas gratuitas cambian a menudo: mira el panel del
    proveedor antes de fiarte del número. Tu clave se cifra en el servidor y <b>no se puede volver a leer</b> desde aquí.</p>`;

  const decir = (id, texto, mal) => {
    const e = caja.querySelector(`[data-res="${id}"]`);
    if (e) e.innerHTML = mal ? `<span class="bad">${esc(texto)}</span>` : `<span class="good">${esc(texto)}</span>`;
  };
  const ajustes = () => ({
    confianza_min: Number($("#iaConf")?.value ?? 70),
    cada_seg: Number($("#iaCada")?.value ?? 60),
  });

  caja.querySelectorAll("[data-guardar]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.guardar;
    const clave = caja.querySelector(`[data-clave="${id}"]`)?.value?.trim() ?? "";
    const modelo = caja.querySelector(`[data-modelo="${id}"]`)?.value?.trim() ?? "";
    if (!clave) return decir(id, "Pega la clave primero", true);
    b.disabled = true;
    decir(id, "Probando la clave…");
    try {
      const r = await action({ action: "ia_guardar", proveedor: id, clave, modelo });
      // El campo se vacía SIEMPRE: la clave ya no vive en el navegador.
      const campo = caja.querySelector(`[data-clave="${id}"]`);
      if (campo) campo.value = "";
      toast(`Clave guardada (${r.pista}). Respondió: ${r.respuesta ?? "ok"}`);
      await pintarIA();
    } catch (e) {
      decir(id, e.message, true);
    } finally {
      b.disabled = false;
    }
  }));

  caja.querySelectorAll("[data-probar]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.probar;
    b.disabled = true;
    decir(id, "Probando…");
    try {
      const r = await action({ action: "ia_probar", proveedor: id });
      decir(id, `Responde bien en ${r.ms} ms: ${r.respuesta}`);
    } catch (e) {
      decir(id, e.message, true);
    } finally {
      b.disabled = false;
    }
  }));

  caja.querySelectorAll("[data-usar]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.usar;
    b.disabled = true;
    try {
      // NACE EN «SOLO OBSERVA», nunca actuando. Encenderla para que decida es un segundo clic
      // consciente, no un efecto secundario de guardar una clave.
      await action({ action: "ia_elegir", proveedor: id, activa: true, modo: 1, ...ajustes() });
      toast(`La IA queda con ${id}, SOLO OBSERVANDO. Para que decida, elige «Actuar».`);
      await pintarIA();
    } catch (e) {
      decir(id, e.message, true);
      b.disabled = false;
    }
  }));

  caja.querySelectorAll("[data-borrar]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.borrar;
    if (!confirm(`¿Borrar la clave de ${id}? Habrá que volver a pegarla para usarla.`)) return;
    b.disabled = true;
    try {
      await action({ action: "ia_borrar", proveedor: id });
      toast("Clave borrada");
      await pintarIA();
    } catch (e) {
      decir(id, e.message, true);
      b.disabled = false;
    }
  }));

  // «Poner las de serie»: rellena el cuadro con el encargo por defecto para poder editarlo.
  caja.querySelectorAll("[data-serie]").forEach((b) => (b.onclick = () => {
    const cual = b.dataset.serie;
    const campo = $(cual === "entrada" ? "#iaEncEntrada" : "#iaEncPosicion");
    if (campo) campo.value = d.encargos?.[cual] ?? "";
    toast("Puestas las instrucciones de serie. Cámbialas y dale a Guardar.");
  }));

  const guardarEnc = $("#iaGuardarEncargos");
  if (guardarEnc) {
    guardarEnc.onclick = async () => {
      guardarEnc.disabled = true;
      try {
        // Accion propia: guarda las instrucciones y los permisos SIN tocar el modo ni exigir que
        // haya una IA elegida. Asi se puede dejar todo escrito antes de encenderla.
        await action({
          action: "ia_encargos",
          valida_entradas: $("#iaEntradas")?.checked === true,
          elige_contrato: $("#iaContrato")?.checked === true,
          mueve_stop: $("#iaStop")?.checked === true,
          ve_graficos: $("#iaGrafico")?.checked === true,
          encargo_entrada: $("#iaEncEntrada")?.value ?? "",
          encargo_posicion: $("#iaEncPosicion")?.value ?? "",
        });
        toast("Instrucciones guardadas");
        await pintarIA();
      } catch (e) {
        toast(e.message);
        guardarEnc.disabled = false;
      }
    };
  }

  // EL INTERRUPTOR. Tres botones, un solo clic, sin buscar nada.
  caja.querySelectorAll("[data-modo]").forEach((b) => (b.onclick = async () => {
    const m = Number(b.dataset.modo);
    const cual = $("#iaCual")?.value || enUso;
    if (m > 0 && !cual) return toast("Primero guarda la clave de una IA");
    b.disabled = true;
    try {
      await action({
        action: "ia_elegir",
        proveedor: cual,
        activa: m > 0,
        modo: m,
        valida_entradas: $("#iaEntradas")?.checked === true,
        elige_contrato: $("#iaContrato")?.checked === true,
        mueve_stop: $("#iaStop")?.checked === true,
        ve_graficos: $("#iaGrafico")?.checked === true,
        ...ajustes(),
      });
      toast(m === 0
        ? "IA apagada. El bot vuelve a gestionar solo con las reglas del documento."
        : m === 1
        ? `La IA queda SOLO OBSERVANDO con ${cual}: opina y se registra, sin tocar nada.`
        : `La IA pasa a ACTUAR con ${cual}.`);
      await pintarIA();
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  }));

  const guardarModo = $("#iaGuardarModo");
  if (guardarModo) {
    guardarModo.onclick = async () => {
      guardarModo.disabled = true;
      try {
        // El modo lo manda el interruptor de arriba; aqui solo se guardan los permisos.
        const m = modo;
        await action({
          action: "ia_elegir", proveedor: enUso, activa: m > 0, modo: m,
          valida_entradas: $("#iaEntradas")?.checked === true,
          elige_contrato: $("#iaContrato")?.checked === true,
          mueve_stop: $("#iaStop")?.checked === true,
          ve_graficos: $("#iaGrafico")?.checked === true,
          ...ajustes(),
        });
        toast(m === 2 ? "La IA pasa a actuar" : "La IA queda solo observando");
        await pintarIA();
      } catch (e) {
        toast(e.message);
        guardarModo.disabled = false;
      }
    };
  }

  const off = $("#iaApagar");
  if (off) {
    off.onclick = async () => {
      off.disabled = true;
      try {
        await action({ action: "ia_elegir", activa: false });
        toast("IA apagada. El bot vuelve a gestionar solo con las reglas del documento.");
        await pintarIA();
      } catch (e) {
        toast(e.message);
        off.disabled = false;
      }
    };
  }
}
