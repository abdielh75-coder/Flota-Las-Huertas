(() => {
'use strict';
const CFG = window.FLOTA_CONFIG || {};
const DEMO = !CFG.API_URL;
const VERSION = '1.0';

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => dstr(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const num = v => { const n = Number(String(v).replace(/,/g, '.').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : NaN; };
const fmtDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? m[3] + '/' + m[2] + '/' + m[1] : s; };
const unitText = u => `${u.placas} · ${[u.marca, u.modelo].filter(Boolean).join(' ')} · ${u.color || ''}`;
const unitShort = u => `${u.placas} (${[u.marca, u.modelo].filter(Boolean).join(' ')})`;

const ICON = {
  fuel: '<svg viewBox="0 0 24 24"><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M6 8h6M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.5-.5-2.1z"/></svg>',
  tool: '<svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 4h6v3H9zM7 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M8 12h8M8 16h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};
const TYPES = {
  Combustible: { title: 'Combustible del día', icon: 'fuel', modes: false },
  Mantenimiento: { title: 'Mantenimiento', icon: 'wrench', modes: true },
  'Reparación': { title: 'Reparación', icon: 'tool', modes: true }
};

/* ---------- estado ---------- */
let session = LS.get('fh_session', null);
let data = LS.get('fh_data', { catalog: [], drivers: [], conceptos: [], pending: [], params: { fotoObligatoria: true, diasAtras: 7 } });
let recent = LS.get('fh_recent', []);
let F = null;            // estado del formulario abierto
let syncing = false;
let queueCache = [];

/* ---------- cola sin conexión (IndexedDB) ---------- */
const Q = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('flota-huertas', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'qid' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('queue', mode), s = t.objectStore('queue');
      const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()).catch(() => []); },
  put(item) { return this.tx('readwrite', s => s.put(item)); },
  del(qid) { return this.tx('readwrite', s => s.delete(qid)); }
};
async function refreshQueue() { queueCache = await Q.all(); return queueCache; }

/* ---------- API ---------- */
async function api(body) {
  if (DEMO) { if (!navigator.onLine) { const er = new Error('network'); er.network = true; throw er; } return window.FLOTA_DEMO_API(body); }
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
    return await res.json();
  } catch (e) { const err = new Error('network'); err.network = true; throw err; }
  finally { clearTimeout(t); }
}

/* ---------- interfaz base ---------- */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function head(title, sub, back) {
  return `<div class="top">${back ? `<button class="iconbtn" data-act="home" aria-label="Volver al inicio">‹</button>` : ''}
    <img src="assets/logo.jpg" alt="Panadería Las Huertas"><div class="ttl"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
}
const app = () => $('#app');

/* ---------- pantalla: acceso ---------- */
function viewLogin(msg) {
  closeModal();
  app().innerHTML = `<div class="login">
    <div class="hero"><img src="assets/logo.jpg" alt="Panadería Las Huertas"><p>Bitácora de flota</p></div>
    ${DEMO ? '<div class="banner demo"><span>MODO DEMO · usuario <b>demo</b> · PIN <b>123456</b> · nada se sube a Drive</span></div>' : ''}
    ${msg ? `<div class="msg" role="alert">${esc(msg)}</div>` : ''}
    <form id="loginForm" autocomplete="off">
      <div class="fld"><label for="u">Usuario</label><input id="u" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(LS.get('fh_lastuser', ''))}" required></div>
      <div class="fld"><label for="p">PIN de 6 dígitos</label><input id="p" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required></div>
      <button class="btn primary" id="loginBtn" type="submit">Entrar</button>
    </form></div>`;
  $('#loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#loginBtn'), user = $('#u').value.trim(), pin = $('#p').value.trim();
    if (!/^\d{6}$/.test(pin)) return viewLogin('El PIN debe tener 6 dígitos.');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Entrando…';
    try {
      const r = await api({ action: 'login', user, pin });
      if (!r.ok) return viewLogin(r.error);
      session = { token: r.token, name: r.name, role: r.role, user: r.user, at: Date.now() };
      LS.set('fh_session', session); LS.set('fh_lastuser', user);
      await loadBootstrap(); viewHome(); syncQueue();
    } catch (e) { viewLogin('Sin conexión. Se necesita internet para entrar la primera vez.'); }
  });
}
function logout(msg) { session = null; LS.del('fh_session'); viewLogin(msg); }

async function loadBootstrap(silent) {
  try {
    const r = await api({ action: 'bootstrap', token: session.token });
    if (r.ok) { data = { catalog: r.catalog, drivers: r.drivers, conceptos: r.conceptos, pending: r.pending, params: r.params, at: Date.now() }; LS.set('fh_data', data); return true; }
    if (r.code === 'AUTH') { logout(r.error); return false; }
    if (!silent) toast(r.error || 'No se pudo actualizar.');
  } catch (e) { if (!silent) toast('Sin conexión: usando los datos guardados.'); }
  return false;
}

/* ---------- pantalla: inicio ---------- */
async function viewHome() {
  closeModal(); F = null;
  await refreshQueue();
  const waiting = queueCache.filter(q => !q.rejected), rej = queueCache.filter(q => q.rejected);
  const online = navigator.onLine;
  app().innerHTML = `
  <div class="hero"><img src="assets/logo.jpg" alt="Panadería Las Huertas"><p>Hola, <b>${esc((session.name || '').split(' ')[0])}</b></p></div>
  ${DEMO ? '<div class="banner demo"><span>MODO DEMO · los datos se guardan solo en este teléfono</span></div>' : ''}
  ${!online ? '<div class="banner off">Sin señal. Puedes capturar: se enviará al volver la conexión.</div>' : ''}
  ${waiting.length ? `<div class="banner q"><span>${waiting.length} registro(s) por enviar</span><button class="link" data-act="sync">Enviar ahora</button></div>` : ''}
  ${rej.map(q => `<div class="banner rej"><b>No se pudo guardar:</b> ${esc(q.label)}<br>${esc(q.rejected)}<br><button class="link" data-act="discard" data-qid="${esc(q.qid)}">Descartar</button></div>`).join('')}
  <div class="tiles">
    <button class="tile t-fuel" data-act="new" data-type="Combustible">${ICON.fuel}<span><b>Combustible<br>del día</b></span></button>
    <button class="tile t-mant" data-act="new" data-type="Mantenimiento">${ICON.wrench}<span><b>Mantenimiento</b><br><small>Registrar o programar</small></span></button>
    <button class="tile t-rep" data-act="new" data-type="Reparación">${ICON.tool}<span><b>Reparación</b><br><small>Registrar o programar</small></span></button>
    <button class="tile t-pend" data-act="pending">${ICON.list}${data.pending && data.pending.length ? `<span class="badge">${data.pending.length}</span>` : ''}<span><b>Pendientes</b><br><small>Programados por cerrar</small></span></button>
  </div>
  ${recent.length ? `<div class="sec">Últimos envíos</div><div class="recent">${recent.slice(0, 5).map(r => `<div><span>${esc(r.tipo)} · ${esc(r.placas)}</span><span>${esc(r.estado)}</span></div>`).join('')}</div>` : ''}
  <div class="foot"><button class="link" data-act="refresh">Actualizar unidades y conductores</button><button class="link" data-act="logout">Cerrar sesión</button></div>
  <div class="ver">Flota Las Huertas · v${VERSION}</div>`;
}

/* ---------- formulario ---------- */
function opts(list, sel, ph) { return (ph ? `<option value="">${esc(ph)}</option>` : '') + list.map(o => { const v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t; return `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`; }).join(''); }
const fld = (id, label, control, req, hint) => `<div class="fld" data-f="${id}"><label for="${id}">${label}${req ? ' <i>*</i>' : ''}</label>${control}<div class="err" id="e_${id}" hidden></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

function openForm(type, mode, keepDraft) {
  closeModal();
  const T = TYPES[type];
  F = { type, mode: T.modes ? (mode || 'Registro') : 'Registro', id: uuid(), photo: null, driverTouched: false };
  renderForm();
}

function draftKey() { return `fh_draft_${F.type}_${F.mode}`; }

function renderForm() {
  const T = TYPES[F.type], reg = F.mode === 'Registro', p = data.params || {};
  const draft = LS.get(draftKey(), {});
  const units = data.catalog.filter(u => u.estatus !== 'Baja');
  const driversOpts = data.drivers.slice().concat(['__otro']).map(d => ({ v: d, t: d === '__otro' ? 'Otro (escribir nombre)…' : d }));
  const minD = reg ? addDays(-(p.diasAtras || 7)) : today(), maxD = reg ? today() : addDays(365);
  let body = '';
  if (T.modes) body += `<div class="seg" role="tablist"><button data-act="mode" data-mode="Registro" class="${reg ? 'on' : ''}">Registrar (ya se hizo)</button><button data-act="mode" data-mode="Programación" class="${!reg ? 'on' : ''}">Programar (pendiente)</button></div>`;
  body += fld('unit', 'Unidad', `<select id="unit">${opts(units.map(u => ({ v: u.id, t: unitText(u) })), draft.unit, 'Elige la unidad…')}</select><div class="unitcard" id="unitcard" hidden></div>`, true);
  body += fld('driver', 'Conductor', `<select id="driver">${opts(driversOpts, draft.driver, 'Elige el conductor…')}</select>`, true);
  body += `<div id="otroWrap" hidden>${fld('driverOther', 'Nombre del conductor', `<input id="driverOther" maxlength="60" autocomplete="off" value="${esc(draft.driverOther || '')}">`, true, 'Se marcará como "conductor no registrado" para revisión.')}</div>`;
  body += fld('date', reg ? 'Fecha' : 'Fecha programada', `<input id="date" type="date" min="${minD}" max="${maxD}" value="${esc(draft.date || today())}">`, true);

  if (F.type === 'Combustible') {
    body += fld('concept', 'Tipo de combustible', `<select id="concept">${opts(['Magna', 'Premium', 'Diésel'], draft.concept || 'Magna')}</select>`, true);
    body += `<div class="row2">${fld('liters', 'Litros', `<input id="liters" inputmode="decimal" autocomplete="off" value="${esc(draft.liters || '')}" placeholder="0.0">`, true)}
             ${fld('amount', 'Importe del ticket ($)', `<input id="amount" inputmode="decimal" autocomplete="off" value="${esc(draft.amount || '')}" placeholder="0.00">`, true)}</div>
             <div class="price" id="price">Precio por litro: —</div><div class="gap"></div>`;
    body += fld('provider', 'Estación de servicio', `<input id="provider" maxlength="80" autocomplete="off" value="${esc(draft.provider || '')}" placeholder="Opcional">`);
    body += fld('folio', 'Folio del ticket', `<input id="folio" maxlength="30" autocomplete="off" autocapitalize="characters" value="${esc(draft.folio || '')}">`, true);
    body += photoField('Foto del ticket', p.fotoObligatoria !== false);
  } else if (F.type === 'Mantenimiento') {
    body += fld('concept', 'Servicio', `<select id="concept">${opts(data.conceptos, draft.concept, 'Elige el servicio…')}</select>`, true);
    body += fld('provider', 'Taller o proveedor', `<input id="provider" maxlength="80" autocomplete="off" value="${esc(draft.provider || '')}">`, reg);
    body += fld('amount', reg ? 'Costo total ($)' : 'Costo estimado ($)', `<input id="amount" inputmode="decimal" autocomplete="off" value="${esc(draft.amount || '')}" placeholder="0.00">`, reg);
    if (reg) body += fld('folio', 'Folio de factura o nota', `<input id="folio" maxlength="30" autocomplete="off" value="${esc(draft.folio || '')}">`, false, 'Sin folio, el registro se marca para revisión.');
    body += fld('notes', 'Notas', `<textarea id="notes" maxlength="300">${esc(draft.notes || '')}</textarea>`);
    if (reg) body += photoField('Evidencia (factura o trabajo realizado)', false);
  } else {
    body += fld('concept', reg ? 'Falla o trabajo realizado' : 'Falla o trabajo a realizar', `<input id="concept" maxlength="80" autocomplete="off" value="${esc(draft.concept || '')}" placeholder="Ej. Luces delanteras, frenos…">`, true);
    if (!reg) body += fld('priority', 'Prioridad', `<select id="priority">${opts(['Alta', 'Media', 'Baja'], draft.priority || 'Media')}</select>`, true);
    body += fld('provider', 'Taller o proveedor', `<input id="provider" maxlength="80" autocomplete="off" value="${esc(draft.provider || '')}">`, reg);
    body += fld('amount', reg ? 'Costo total ($)' : 'Cotización estimada ($)', `<input id="amount" inputmode="decimal" autocomplete="off" value="${esc(draft.amount || '')}" placeholder="0.00">`, reg);
    if (reg) body += fld('folio', 'Folio de factura o nota', `<input id="folio" maxlength="30" autocomplete="off" value="${esc(draft.folio || '')}">`, false, 'Sin folio, el registro se marca para revisión.');
    body += fld('notes', 'Notas', `<textarea id="notes" maxlength="300">${esc(draft.notes || '')}</textarea>`);
    if (reg) body += photoField('Evidencia (factura o trabajo realizado)', false);
  }
  app().innerHTML = head(T.title, reg ? 'Registro' : 'Programación', true) +
    `<div class="page" id="form">${body}</div>
     <div class="bar"><button class="btn danger" data-act="clear">Borrar formulario</button><button class="btn primary" data-act="review">Revisar y guardar</button></div>`;
  if (draft.driver === '__otro') $('#otroWrap').hidden = false;
  updateUnitCard(); updatePrice();
}

function photoField(label, required) {
  return `<div class="fld" data-f="photo"><label>${label}${required ? ' <i>*</i>' : ''}</label>
    <div class="photo"><div class="thumb" id="thumb">Sin foto</div>
    <div><input id="photoIn" type="file" accept="image/*" capture="environment" hidden>
    <button class="btn ghost" data-act="photo" type="button">Tomar foto</button></div></div><div class="err" id="e_photo" hidden></div></div>`;
}

function updateUnitCard() {
  const u = data.catalog.find(x => x.id === ($('#unit') || {}).value), c = $('#unitcard');
  if (!c) return;
  if (!u) { c.hidden = true; return; }
  c.hidden = false;
  c.innerHTML = `<b>${esc(u.placas)}</b> · ${esc([u.marca, u.modelo, u.anio].filter(Boolean).join(' '))} · ${esc(u.color || '')}<br>${esc(u.tipo || '')} · serie …${esc(u.id)}${u.tanque ? ' · tanque ' + esc(u.tanque) + ' L' : ''}`;
}
function updatePrice() {
  const el = $('#price'); if (!el) return;
  const l = num($('#liters').value), m = num($('#amount').value), p = data.params || {};
  if (l > 0 && m > 0) {
    const pr = m / l, bad = (p.precioMin && pr < p.precioMin) || (p.precioMax && pr > p.precioMax);
    el.textContent = 'Precio por litro: ' + money(pr) + (bad ? '  ·  ¡revisa los datos!' : ''); el.classList.toggle('warn', !!bad);
  } else { el.textContent = 'Precio por litro: —'; el.classList.remove('warn'); }
}

function collect() {
  const g = id => { const e = $('#' + id); return e ? e.value.trim() : ''; };
  return { unit: g('unit'), driver: g('driver'), driverOther: g('driverOther'), date: g('date'), concept: g('concept'), provider: g('provider'),
           folio: g('folio'), liters: g('liters'), amount: g('amount'), priority: g('priority'), notes: g('notes') };
}
function saveDraft() { if (F) LS.set(draftKey(), collect()); }

function validate(v) {
  const e = {}, reg = F.mode === 'Registro', p = data.params || {};
  if (!v.unit) e.unit = 'Elige la unidad.';
  if (!v.driver) e.driver = 'Elige el conductor.';
  else if (v.driver === '__otro' && v.driverOther.length < 3) e.driverOther = 'Escribe el nombre.';
  if (!v.date) e.date = 'Falta la fecha.';
  else { const mx = reg ? today() : addDays(365), mn = reg ? addDays(-(p.diasAtras || 7)) : today(); if (v.date > mx || v.date < mn) e.date = reg ? `La fecha debe ser de los últimos ${p.diasAtras || 7} días.` : 'La fecha programada no puede estar en el pasado.'; }
  if (!v.concept) e.concept = F.type === 'Reparación' ? 'Describe la falla o el trabajo.' : 'Elige una opción.';
  if (F.type === 'Combustible') {
    const l = num(v.liters), m = num(v.amount);
    if (!(l >= 1 && l <= 200)) e.liters = 'Litros entre 1 y 200.';
    if (!(m >= 10 && m <= 10000)) e.amount = 'Importe no válido.';
    if (v.folio.length < 3) e.folio = 'Captura el folio del ticket.';
    if (p.fotoObligatoria !== false && !F.photo) e.photo = 'La foto del ticket es obligatoria.';
  } else {
    const m = num(v.amount);
    if (reg) { if (!(m >= 0 && m <= 500000) || v.amount === '') e.amount = 'Captura el costo total.'; if (!v.provider) e.provider = 'Captura el taller o proveedor.'; }
    else if (v.amount !== '' && !(m >= 0 && m <= 500000)) e.amount = 'Monto no válido.';
  }
  return e;
}
function showErrors(e) {
  document.querySelectorAll('.fld.bad').forEach(n => n.classList.remove('bad'));
  document.querySelectorAll('.err').forEach(n => { n.hidden = true; });
  let first = null;
  Object.keys(e).forEach(k => { const w = document.querySelector(`[data-f="${k}"]`), m = $('#e_' + k); if (w) { w.classList.add('bad'); first = first || w; } if (m) { m.textContent = e[k]; m.hidden = false; } });
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function buildRecord(v) {
  const driver = v.driver === '__otro' ? v.driverOther : v.driver;
  return { id: F.id, type: F.type, mode: F.mode, unit: v.unit, driver, date: v.date, concept: v.concept, provider: v.provider, folio: v.folio,
           liters: F.type === 'Combustible' ? num(v.liters) : '', amount: v.amount === '' ? '' : num(v.amount), priority: v.priority, notes: v.notes,
           photo: F.photo ? { mime: F.photo.mime, b64: F.photo.b64 } : null };
}

function review() {
  const v = collect(), e = validate(v); showErrors(e);
  if (Object.keys(e).length) { toast('Revisa los campos marcados.'); return; }
  const u = data.catalog.find(x => x.id === v.unit), r = buildRecord(v), rows = [];
  rows.push(['Tipo', F.type + (TYPES[F.type].modes ? ' · ' + (F.mode === 'Registro' ? 'registro' : 'programación') : '')]);
  rows.push(['Unidad', unitShort(u)], ['Conductor', r.driver], ['Fecha', fmtDate(r.date)], [F.type === 'Combustible' ? 'Combustible' : 'Concepto', r.concept]);
  if (F.type === 'Combustible') rows.push(['Litros', r.liters], ['Importe', money(r.amount)], ['Precio por litro', money(r.amount / r.liters)], ['Folio', r.folio]);
  else { if (r.provider) rows.push(['Proveedor', r.provider]); if (r.amount !== '') rows.push([F.mode === 'Registro' ? 'Costo' : 'Estimado', money(r.amount)]); if (r.folio) rows.push(['Folio', r.folio]); if (r.priority) rows.push(['Prioridad', r.priority]); }
  rows.push(['Foto', F.photo ? 'Adjunta' : 'Sin foto']);
  modal(`<h2>Confirma los datos</h2><table class="sum">${rows.map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>
    <div class="stack"><button class="btn primary" data-act="send">Confirmar y subir a la matriz</button><button class="btn ghost" data-act="closeModal">Corregir</button></div>`);
}

async function send() {
  const v = collect(), r = buildRecord(v), u = data.catalog.find(x => x.id === v.unit);
  const btn = $('[data-act="send"]'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Subiendo…';
  const label = `${F.type} · ${u ? u.placas : ''} · ${fmtDate(r.date)}`;
  let res = null, queued = false;
  try { res = await api({ action: 'submit', token: session.token, record: r }); }
  catch (e) { queued = true; }
  if (res && !res.ok && res.code === 'VALIDATION') { closeModal(); toast(res.error, 5000); return; }
  if (res && !res.ok && res.code === 'AUTH') { queued = true; }
  else if (res && !res.ok) { closeModal(); toast(res.error || 'No se pudo guardar.', 5000); return; }
  if (queued) { await Q.put({ qid: r.id, kind: 'submit', body: r, label, at: Date.now() }); recordRecent(F.type, u, 'Por enviar'); }
  else recordRecent(F.type, u, res.estatus === 'Pendiente' ? 'Programado' : 'Guardado');
  LS.del(draftKey()); F.done = true;
  const alerts = (res && res.alerts) || [];
  modal(`<div class="center"><div class="okmark ${queued ? 'q' : ''}">${ICON.check}</div>
    <h2>${queued ? 'Guardado en el teléfono' : (res.dup ? 'Ya estaba guardado' : 'Subido a la matriz')}</h2>
    <p>${esc(label)}</p>
    ${queued ? '<p class="hint">No hay conexión o la sesión venció. Se enviará solo al volver la señal.</p>' : ''}
    ${alerts.length ? `<div class="warnbox"><b>Marcado para revisión del auditor:</b><br>${alerts.map(a => '• ' + esc(a)).join('<br>')}</div>` : ''}</div>
    <div class="stack"><button class="btn primary" data-act="clearnew">Borrar formulario y registrar otro</button>
    <button class="btn ghost" data-act="keep">Conservar datos (mismo conductor/unidad)</button>
    <button class="btn ghost" data-act="home">Ir al inicio</button></div>`);
  if (res && res.ok && !res.dup && session) loadBootstrap(true);
  if (queued && res && res.code === 'AUTH') { /* se pedirá PIN al salir de la confirmación */ F.needLogin = true; }
}

function recordRecent(tipo, u, estado) {
  recent.unshift({ tipo, placas: u ? u.placas : '', estado, t: Date.now() }); recent = recent.slice(0, 10); LS.set('fh_recent', recent);
}

/* ---------- pendientes ---------- */
async function viewPending() {
  closeModal();
  app().innerHTML = head('Pendientes', 'Programados por cerrar', true) + '<div class="list"><div class="empty">Cargando…</div></div>';
  await loadBootstrap(true);
  const list = (data.pending || []);
  const t = today();
  app().innerHTML = head('Pendientes', 'Programados por cerrar', true) + `<div class="list">${list.length ? list.map(p => {
    const late = p.fecha < t;
    return `<button class="item ${late ? 'late' : ''}" data-act="closeform" data-id="${esc(p.id)}"><span class="pill ${late ? 'red' : ''}">${late ? 'Vencido' : 'Programado'} ${esc(fmtDate(p.fecha))}</span><span class="pill">${esc(p.tipo)}</span><br><b>${esc(p.placas)}</b> · ${esc(p.concepto)}<div class="meta">${esc(p.desc || '')}${p.proveedor ? ' · ' + esc(p.proveedor) : ''}</div>${p.notas ? `<div class="meta">${esc(p.notas)}</div>` : ''}</button>`;
  }).join('') : '<div class="empty">No hay pendientes. 🎉</div>'}</div>`;
}

function openClose(id) {
  const p = data.pending.find(x => String(x.id) === String(id)); if (!p) return;
  F = { type: p.tipo, mode: 'Cierre', id: p.id, photo: null, closing: p };
  app().innerHTML = head('Cerrar pendiente', p.placas + ' · ' + p.concepto, true) + `<div class="page" id="form">
    <div class="unitcard">${esc(p.tipo)} programado para ${esc(fmtDate(p.fecha))}<br><b>${esc(p.concepto)}</b> · ${esc(p.desc || '')}</div><div class="gap"></div>
    ${fld('date', 'Fecha en que se realizó', `<input id="date" type="date" min="${addDays(-((data.params || {}).diasAtras || 7))}" max="${today()}" value="${today()}">`, true)}
    ${fld('provider', 'Taller o proveedor', `<input id="provider" maxlength="80" autocomplete="off" value="${esc(p.proveedor || '')}">`, true)}
    ${fld('amount', 'Costo total ($)', `<input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(p.monto || '')}">`, true)}
    ${fld('folio', 'Folio de factura o nota', `<input id="folio" maxlength="30" autocomplete="off">`, false, 'Sin folio, el registro se marca para revisión.')}
    ${fld('notes', 'Notas del cierre', `<textarea id="notes" maxlength="300"></textarea>`)}
    ${photoField('Evidencia (factura o trabajo realizado)', false)}</div>
    <div class="bar"><button class="btn ghost" data-act="pending">Cancelar</button><button class="btn primary" data-act="doclose">Cerrar pendiente</button></div>`;
}

async function doClose() {
  const g = id => $('#' + id).value.trim(), e = {};
  const v = { date: g('date'), provider: g('provider'), amount: g('amount'), folio: g('folio'), notes: g('notes') };
  const m = num(v.amount);
  if (!v.date) e.date = 'Falta la fecha.'; if (!v.provider) e.provider = 'Captura el taller o proveedor.'; if (v.amount === '' || !(m >= 0 && m <= 500000)) e.amount = 'Captura el costo total.';
  showErrors(e); if (Object.keys(e).length) return;
  const btn = $('[data-act="doclose"]'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Guardando…';
  const body = { id: F.id, date: v.date, provider: v.provider, amount: m, folio: v.folio, notes: v.notes, photo: F.photo ? { mime: F.photo.mime, b64: F.photo.b64 } : null };
  const label = `Cierre ${F.closing.tipo} · ${F.closing.placas}`;
  let res = null, queued = false;
  try { res = await api({ action: 'close', token: session.token, data: body }); } catch (x) { queued = true; }
  if (res && !res.ok && res.code === 'AUTH') queued = true;
  else if (res && !res.ok) { btn.disabled = false; btn.textContent = 'Cerrar pendiente'; toast(res.error || 'No se pudo cerrar.', 5000); return; }
  if (queued) await Q.put({ qid: 'close-' + F.id, kind: 'close', body, label, at: Date.now() });
  data.pending = data.pending.filter(x => String(x.id) !== String(F.id)); LS.set('fh_data', data);
  recordRecent(F.closing.tipo, { placas: F.closing.placas }, queued ? 'Por enviar' : 'Cerrado');
  const alerts = (res && res.alerts) || [];
  modal(`<div class="center"><div class="okmark ${queued ? 'q' : ''}">${ICON.check}</div><h2>${queued ? 'Guardado en el teléfono' : 'Pendiente cerrado'}</h2><p>${esc(label)}</p>
    ${alerts.length ? `<div class="warnbox"><b>Marcado para revisión del auditor:</b><br>${alerts.map(a => '• ' + esc(a)).join('<br>')}</div>` : ''}</div>
    <div class="stack"><button class="btn primary" data-act="pending">Ver pendientes</button><button class="btn ghost" data-act="home">Ir al inicio</button></div>`);
}

/* ---------- sincronización ---------- */
async function syncQueue() {
  if (syncing || !session || !navigator.onLine) return;
  syncing = true;
  try {
    const items = (await refreshQueue()).filter(q => !q.rejected).sort((a, b) => a.at - b.at);
    for (const it of items) {
      let r;
      try { r = await api(it.kind === 'submit' ? { action: 'submit', token: session.token, record: it.body } : { action: 'close', token: session.token, data: it.body }); }
      catch (e) { break; }
      if (r.ok) { await Q.del(it.qid); recent.forEach(x => { if (x.estado === 'Por enviar') x.estado = 'Guardado'; }); LS.set('fh_recent', recent); }
      else if (r.code === 'AUTH') { logout('Tu sesión venció. Entra de nuevo para enviar lo pendiente.'); break; }
      else { it.rejected = r.error || 'Rechazado por el servidor.'; await Q.put(it); }
    }
  } finally { syncing = false; }
  if ($('.tiles')) viewHome();
}

/* ---------- fotos ---------- */
function resizeImage(file, max = 1280, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * r), h = Math.round(img.height * r);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      const d = c.toDataURL('image/jpeg', q); URL.revokeObjectURL(url); res({ mime: 'image/jpeg', b64: d.split(',')[1], url: d });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}

/* ---------- eventos ---------- */
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'home': if (F && F.needLogin) { logout('Tu sesión venció. Entra de nuevo para enviar lo pendiente.'); break; } viewHome(); break;
    case 'new': openForm(el.dataset.type); break;
    case 'mode': if (F && F.mode !== el.dataset.mode) { saveDraft(); F.mode = el.dataset.mode; F.photo = null; renderForm(); } break;
    case 'photo': $('#photoIn').click(); break;
    case 'review': review(); break;
    case 'send': send(); break;
    case 'closeModal': closeModal(); break;
    case 'clear':
      modal(`<h2>¿Borrar el formulario?</h2><p>Se perderán los datos capturados que aún no se han subido.</p><div class="stack"><button class="btn danger" data-act="clearyes">Sí, borrar</button><button class="btn ghost" data-act="closeModal">No, regresar</button></div>`); break;
    case 'clearyes': case 'clearnew': { const t = F.type, m = F.mode; LS.del(draftKey()); if (F.closing) { viewPending(); break; } openForm(t, m); toast('Formulario borrado'); break; }
    case 'keep': { const v = collect(); F.id = uuid(); F.done = false; F.photo = null; LS.set(draftKey(), { ...v, folio: '', amount: v.amount, liters: '' }); closeModal(); renderForm(); if (F.needLogin) { logout('Tu sesión venció. Entra de nuevo para enviar lo pendiente.'); } break; }
    case 'pending': viewPending(); break;
    case 'closeform': openClose(el.dataset.id); break;
    case 'doclose': doClose(); break;
    case 'sync': toast('Enviando…'); syncQueue(); break;
    case 'discard': await Q.del(el.dataset.qid); viewHome(); break;
    case 'refresh': el.disabled = true; toast('Actualizando…'); await loadBootstrap(); viewHome(); break;
    case 'logout': logout(); break;
  }
});
document.addEventListener('input', ev => {
  if (!F || !$('#form')) return;
  if (ev.target.id === 'liters' || ev.target.id === 'amount') updatePrice();
  if (ev.target.id === 'driver') { F.driverTouched = true; $('#otroWrap').hidden = ev.target.value !== '__otro'; }
  saveDraft();
});
document.addEventListener('change', async ev => {
  if (!F) return;
  if (ev.target.id === 'unit') {
    updateUnitCard();
    const u = data.catalog.find(x => x.id === ev.target.value), d = $('#driver');
    if (u && d && !F.driverTouched && u.conductor && data.drivers.includes(u.conductor)) { d.value = u.conductor; }
    saveDraft();
  }
  if (ev.target.id === 'photoIn' && ev.target.files[0]) {
    try { F.photo = await resizeImage(ev.target.files[0]); $('#thumb').innerHTML = `<img alt="Foto adjunta" src="${F.photo.url}">`; const m = $('#e_photo'); if (m) m.hidden = true; }
    catch (e) { toast('No se pudo leer la foto. Intenta de nuevo.'); }
  }
});
window.addEventListener('online', () => { toast('Conexión recuperada'); syncQueue(); });
window.addEventListener('offline', () => { if ($('.tiles')) viewHome(); });
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (session && hiddenAt && (Date.now() - hiddenAt) > (CFG.IDLE_LOCK_MINUTES || 15) * 60000) logout('Por seguridad, vuelve a escribir tu PIN.');
  else if (session) syncQueue();
});

/* ---------- arranque ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
(async function start() {
  await refreshQueue();
  if (session && session.token) { viewHome(); loadBootstrap(true).then(() => { if ($('.tiles')) viewHome(); }); syncQueue(); }
  else viewLogin();
})();
})();
