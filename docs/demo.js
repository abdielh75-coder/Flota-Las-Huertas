// MODO DEMO: simula el servidor en el propio navegador (solo cuando config.js no tiene API_URL).
// Usuario: demo   PIN: 123456.  Los datos NO salen del dispositivo.
(function () {
  const KEY = 'fh_demo_db';
  const seed = {
    catalog: [
      { id: '10234', placas: 'ABC-101-A', marca: 'Nissan', modelo: 'NP300', anio: 2020, color: 'Blanco', tipo: 'Vehículo', conductor: 'Conductor Uno', tanque: 60, estatus: 'Activa' },
      { id: '55871', placas: 'ABC-102-A', marca: 'Ford', modelo: 'Transit', anio: 2019, color: 'Blanco', tipo: 'Vehículo', conductor: 'Conductor Dos', tanque: 80, estatus: 'Activa' },
      { id: '90412', placas: 'ABC-103-A', marca: 'Chevrolet', modelo: 'Tornado', anio: 2018, color: 'Gris', tipo: 'Vehículo', conductor: 'Conductor Tres', tanque: 45, estatus: 'Activa' },
      { id: '33108', placas: 'MX-2201', marca: 'Italika', modelo: 'FT150', anio: 2022, color: 'Rojo', tipo: 'Motocicleta', conductor: 'Conductor Cuatro', tanque: 12, estatus: 'Activa' }
    ],
    drivers: ['Conductor Uno', 'Conductor Dos', 'Conductor Tres', 'Conductor Cuatro'],
    conceptos: ['Cambio de aceite y filtros', 'Servicio mayor', 'Afinación', 'Frenos', 'Llantas (rotación o cambio)', 'Batería',
      'Suspensión y dirección', 'Cadena y kit de arrastre (moto)', 'Verificación vehicular', 'Lavado y engrasado', 'Otro'],
    records: [
      { id: 'demo-pend-0001', fecha: '', tipo: 'Mantenimiento', placas: 'ABC-101-A', desc: 'Nissan NP300 2020 Blanco', concepto: 'Cambio de aceite y filtros', proveedor: 'Taller ejemplo', notas: '', estatus: 'Pendiente', unit: '10234', monto: '' }
    ]
  };
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function db() { let d = load(); if (!d) { d = JSON.parse(JSON.stringify(seed)); d.records[0].fecha = today(); save(d); } return d; }
  const fail = (code, error) => ({ ok: false, code, error });

  window.FLOTA_DEMO_API = async function (b) {
    await new Promise(r => setTimeout(r, 350));
    if (b.action === 'login') {
      if (String(b.user).toLowerCase() === 'demo' && b.pin === '123456') return { ok: true, token: 'demo-token', name: 'Usuario de demostración', role: 'admin', user: 'demo' };
      return fail('AUTH', 'Usuario o PIN incorrecto. (Demo: usuario demo, PIN 123456)');
    }
    if (b.token !== 'demo-token') return fail('AUTH', 'Sesión vencida. Vuelve a entrar.');
    const d = db();
    const pend = () => d.records.filter(r => r.estatus === 'Pendiente');
    if (b.action === 'bootstrap') {
      return { ok: true, catalog: d.catalog, drivers: d.drivers, conceptos: d.conceptos, pending: pend(), serverDate: today(), name: 'Usuario de demostración', role: 'admin',
        params: { fotoObligatoria: true, diasAtras: 7, precioMin: 15, precioMax: 40 } };
    }
    if (b.action === 'submit') {
      const r = b.record || {};
      if (d.records.some(x => x.id === r.id)) return { ok: true, dup: true, id: r.id };
      const u = d.catalog.find(c => c.id === r.unit);
      if (!u) return fail('VALIDATION', 'La unidad no existe en el catálogo.');
      const alerts = [];
      if (r.type === 'Combustible') {
        const l = Number(r.liters), m = Number(r.amount);
        if (!(l >= 1 && l <= 200)) return fail('VALIDATION', 'Litros fuera de rango (1 a 200).');
        if (!(m >= 10)) return fail('VALIDATION', 'Importe fuera de rango.');
        if (!r.photo) return fail('VALIDATION', 'La foto del ticket es obligatoria.');
        if (u.tanque && l > u.tanque * 1.05) alerts.push('Litros mayores a la capacidad del tanque');
        if (d.records.some(x => x.folio && x.folio === r.folio)) alerts.push('Folio de ticket repetido');
      }
      d.records.push({ id: r.id, fecha: r.date, tipo: r.type, placas: u.placas, desc: [u.marca, u.modelo, u.anio, u.color].join(' '), concepto: r.concept,
        proveedor: r.provider, folio: r.folio, notas: r.notes, monto: r.amount, estatus: r.mode === 'Programación' ? 'Pendiente' : 'Registrado', unit: u.id });
      save(d);
      return { ok: true, id: r.id, alerts, estatus: r.mode === 'Programación' ? 'Pendiente' : 'Registrado', placas: u.placas };
    }
    if (b.action === 'close') {
      const r = d.records.find(x => x.id === b.data.id);
      if (!r) return fail('VALIDATION', 'No se encontró el registro.');
      r.estatus = 'Cerrado'; r.monto = b.data.amount; r.folio = b.data.folio; save(d);
      return { ok: true, id: r.id, alerts: [], estatus: 'Cerrado' };
    }
    return fail('BAD_REQUEST', 'Acción desconocida.');
  };
})();
