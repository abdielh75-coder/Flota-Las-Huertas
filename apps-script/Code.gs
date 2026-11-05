/**
 * FLOTA LAS HUERTAS - Backend (Google Apps Script ligado a la hoja de cálculo)
 *
 * Recibe los registros de la app, los valida, los guarda en la hoja "Registros"
 * y mantiene el "Panel" (búsqueda por periodo, filtros, indicadores y gráficas).
 *
 * Instalación: ver README.md. Resumen: pegar este archivo en Extensiones > Apps Script,
 * ejecutar instalar(), crear usuarios desde el menú "Flota Las Huertas" e implementar como
 * Aplicación web (Ejecutar como: Yo / Acceso: Cualquier persona).
 */

var SH = {
  REG: 'Registros', CAT: 'Catálogo', DRV: 'Conductores', USR: 'Usuarios',
  PAR: 'Parámetros', PAN: 'Panel', FIL: '_Filtro', GRA: '_Graf', LOG: 'Bitácora'
};

// Columnas de "Registros" (índice base 1)
var C = { ID: 1, FECHA: 2, TIPO: 3, UNIDAD: 4, PLACAS: 5, DESC: 6, COND: 7, CONC: 8, PROV: 9, FOLIO: 10,
          LITROS: 11, PRECIO: 12, MONTO: 13, ESTATUS: 14, NOTAS: 15, FOTO: 16, ALERTAS: 17,
          USUARIO: 18, CAPT: 19, CIERRE: 20 };
var REG_HEAD = ['ID', 'Fecha', 'Tipo', 'Unidad (serie)', 'Placas', 'Descripción de la unidad', 'Conductor', 'Concepto',
                'Proveedor / estación', 'Folio', 'Litros', 'Precio por litro', 'Monto', 'Estatus', 'Notas', 'Foto',
                'Alertas', 'Capturó', 'Capturado el', 'Fecha de cierre'];

var DEFAULT_PARAMS = [
  ['FOTO_TICKET_OBLIGATORIA', 'Sí', 'Sí = no se acepta una carga de combustible sin foto del ticket.'],
  ['PRECIO_LITRO_MIN', 15, 'Precio por litro mínimo razonable (MXN). Fuera de rango genera alerta.'],
  ['PRECIO_LITRO_MAX', 40, 'Precio por litro máximo razonable (MXN).'],
  ['FACTOR_TANQUE', 1.05, 'Alerta si los litros exceden la capacidad del tanque por este factor.'],
  ['FACTOR_ATIPICO', 2, 'Alerta si los litros superan este múltiplo de la mediana de las últimas cargas de la unidad.'],
  ['DIAS_ATRAS_MAX', 7, 'Máximo de días hacia atrás permitidos para un registro (evita fechas inventadas).'],
  ['UMBRAL_MONTO', 2500, 'Monto de mantenimiento/reparación que se marca como "requiere autorización".'],
  ['DIAS_PENDIENTE_ALERTA', 5, 'Días después de la fecha programada en que un pendiente se marca vencido.']
];
var CONCEPTOS_MANT = ['Cambio de aceite y filtros', 'Servicio mayor', 'Afinación', 'Frenos', 'Llantas (rotación o cambio)',
  'Batería', 'Suspensión y dirección', 'Cadena y kit de arrastre (moto)', 'Verificación vehicular', 'Lavado y engrasado', 'Otro'];
var TIPOS = ['Combustible', 'Mantenimiento', 'Reparación'];

/* ===================================================================== */
/*  MENÚ                                                                  */
/* ===================================================================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Flota Las Huertas')
    .addItem('1. Instalar / reparar estructura', 'instalar')
    .addItem('2. Agregar o cambiar usuario de la app', 'agregarUsuario')
    .addItem('3. Actualizar gráficos (después de agregar unidades)', 'construirGraficos')
    .addItem('4. Proteger hojas', 'protegerHojas')
    .addSeparator()
    .addItem('Ver dirección (URL) de la app web', 'verUrl')
    .addToUi();
}

function verUrl() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  SpreadsheetApp.getUi().alert(url
    ? 'URL de la aplicación web (pégala en docs/config.js, campo API_URL):\n\n' + url
    : 'Aún no has implementado la aplicación web.\nImplementar > Nueva implementación > Aplicación web.');
}

/* ===================================================================== */
/*  INSTALACIÓN                                                           */
/* ===================================================================== */
function instalar() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  ss.setSpreadsheetLocale('es_MX');

  function sheet(name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

  // --- Registros
  var reg = sheet(SH.REG);
  reg.getRange(1, 1, 1, REG_HEAD.length).setValues([REG_HEAD]).setFontWeight('bold')
    .setBackground('#3E5742').setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle');
  reg.setFrozenRows(1); reg.setFrozenColumns(1);
  reg.getRange(2, C.ID, 4999, 1).setNumberFormat('@');
  reg.getRange(2, C.FECHA, 4999, 1).setNumberFormat('dd/mm/yyyy');
  reg.getRange(2, C.UNIDAD, 4999, 1).setNumberFormat('@');
  reg.getRange(2, C.CONC, 4999, 2).setNumberFormat('@');
  reg.getRange(2, C.FOLIO, 4999, 1).setNumberFormat('@');
  reg.getRange(2, C.LITROS, 4999, 1).setNumberFormat('0.00');
  reg.getRange(2, C.PRECIO, 4999, 2).setNumberFormat('$#,##0.00');
  reg.getRange(2, C.CAPT, 4999, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  reg.getRange(2, C.CIERRE, 4999, 1).setNumberFormat('dd/mm/yyyy');
  var widths = [90, 85, 100, 80, 85, 220, 140, 170, 150, 100, 70, 80, 90, 90, 220, 70, 320, 110, 125, 95];
  widths.forEach(function (w, i) { reg.setColumnWidth(i + 1, w); });
  reg.getRange(2, C.ALERTAS, 4999, 1).setFontColor('#9C0006');
  reg.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$N2="Pendiente"')
      .setBackground('#FFF2CC').setRanges([reg.getRange('A2:T5000')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEN($Q2)>0')
      .setBackground('#FCE4D6').setRanges([reg.getRange('Q2:Q5000')]).build()
  ]);
  if (reg.getFilter()) reg.getFilter().remove();
  reg.getRange(1, 1, 5000, REG_HEAD.length).createFilter();

  // --- Catálogo
  var cat = sheet(SH.CAT);
  var catHead = ['Serie (últimos 5)', 'Placas', 'Marca', 'Modelo', 'Año', 'Color', 'Tipo', 'Conductor habitual',
                 'Tanque (litros)', 'Estatus'];
  cat.getRange(1, 1, 1, catHead.length).setValues([catHead]).setFontWeight('bold')
    .setBackground('#AD7E30').setFontColor('#FFFFFF').setWrap(true);
  cat.setFrozenRows(1);
  cat.getRange(2, 1, 100, 2).setNumberFormat('@');
  cat.getRange(2, 7, 100, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Vehículo', 'Motocicleta'], true).build());
  cat.getRange(2, 10, 100, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Activa', 'En taller', 'Baja'], true).build());
  if (cat.getRange('A2').isBlank()) {
    cat.getRange(2, 1, 1, 10).setValues([['12345', 'ABC-123-A', 'Nissan', 'NP300', 2020, 'Blanco', 'Vehículo',
      'Nombre del conductor', 60, 'Activa']]);
    cat.getRange('K2').setValue('← FILA DE EJEMPLO: reemplázala con tus unidades (18 en total).')
      .setFontColor('#7F6000').setFontStyle('italic');
  }
  [110, 100, 100, 110, 60, 100, 100, 160, 90, 90].forEach(function (w, i) { cat.setColumnWidth(i + 1, w); });

  // --- Conductores
  var drv = sheet(SH.DRV);
  drv.getRange(1, 1, 1, 2).setValues([['Conductor', 'Activo']]).setFontWeight('bold')
    .setBackground('#AD7E30').setFontColor('#FFFFFF');
  drv.setFrozenRows(1); drv.setColumnWidth(1, 220);
  drv.getRange(2, 2, 100, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).build());
  if (drv.getRange('A2').isBlank()) drv.getRange(2, 1, 1, 2).setValues([['Nombre del conductor', 'Sí']]);

  // --- Usuarios
  var usr = sheet(SH.USR);
  usr.getRange(1, 1, 1, 5).setValues([['Usuario', 'Nombre', 'Rol', 'PIN (cifrado)', 'Activo']]).setFontWeight('bold')
    .setBackground('#28392C').setFontColor('#FFFFFF');
  usr.setFrozenRows(1); [110, 200, 110, 380, 70].forEach(function (w, i) { usr.setColumnWidth(i + 1, w); });

  // --- Parámetros
  var par = sheet(SH.PAR);
  par.getRange(1, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Qué hace']]).setFontWeight('bold')
    .setBackground('#AD7E30').setFontColor('#FFFFFF');
  if (par.getRange('A2').isBlank()) {
    par.getRange(2, 1, DEFAULT_PARAMS.length, 3).setValues(DEFAULT_PARAMS);
    par.getRange(2, 2, DEFAULT_PARAMS.length, 1).setBackground('#FFF2CC').setFontColor('#0000FF');
  }
  par.getRange('E1').setValue('Conceptos de mantenimiento').setFontWeight('bold').setBackground('#AD7E30').setFontColor('#FFFFFF');
  if (par.getRange('E2').isBlank()) par.getRange(2, 5, CONCEPTOS_MANT.length, 1).setValues(CONCEPTOS_MANT.map(function (c) { return [c]; }));
  par.setColumnWidth(1, 220); par.setColumnWidth(2, 90); par.setColumnWidth(3, 520); par.setColumnWidth(5, 230);

  // --- Bitácora de accesos
  var lg = sheet(SH.LOG);
  lg.getRange(1, 1, 1, 5).setValues([['Fecha y hora', 'Usuario', 'Acción', 'Detalle', 'Resultado']]).setFontWeight('bold')
    .setBackground('#28392C').setFontColor('#FFFFFF');
  lg.setFrozenRows(1); [140, 110, 110, 380, 200].forEach(function (w, i) { lg.setColumnWidth(i + 1, w); });

  // --- Auxiliares y panel
  sheet(SH.FIL); sheet(SH.GRA); sheet(SH.PAN);
  construirPanel_();
  construirGraficos();

  // orden y visibilidad
  var order = [SH.PAN, SH.REG, SH.CAT, SH.DRV, SH.USR, SH.PAR, SH.LOG, SH.FIL, SH.GRA];
  order.forEach(function (n, i) { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); });
  ss.getSheetByName(SH.FIL).hideSheet(); ss.getSheetByName(SH.GRA).hideSheet();
  var s1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  ss.setActiveSheet(ss.getSheetByName(SH.PAN));
  SpreadsheetApp.getUi().alert('Estructura instalada.\n\nSiguientes pasos:\n1) Captura tus unidades en "Catálogo" y conductores en "Conductores".\n' +
    '2) Menú Flota Las Huertas > Agregar o cambiar usuario.\n3) Implementar como Aplicación web.\n4) Menú > Proteger hojas.');
}

/* ===================================================================== */
/*  PANEL (búsqueda, filtros, indicadores y gráficas)                     */
/* ===================================================================== */
function construirPanel_() {
  var ss = SpreadsheetApp.getActive();
  var pan = ss.getSheetByName(SH.PAN), fil = ss.getSheetByName(SH.FIL), gra = ss.getSheetByName(SH.GRA);
  pan.clear(); pan.setHiddenGridlines(true);
  pan.getRange('B1').setValue('Panel de flota - Panadería Las Huertas').setFontSize(18).setFontWeight('bold').setFontColor('#28392C');
  pan.getRange('B2').setValue('Cambia los filtros amarillos: todo el panel se actualiza solo. Los datos vienen de la hoja "Registros" (la app los sube automáticamente).')
    .setFontColor('#5C5346').setFontStyle('italic');

  var labels = [['Desde', 'Hasta', 'Unidad (placas)', 'Tipo', 'Buscar texto (conductor, concepto, folio, proveedor...)']];
  pan.getRange('B4:F4').setValues(labels).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#3E5742');
  pan.getRange('F4:H4').merge();
  pan.getRange('B5').setFormula('=DATE(YEAR(TODAY()),MONTH(TODAY()),1)');
  pan.getRange('C5').setFormula('=TODAY()');
  pan.getRange('D5').setValue('Todas'); pan.getRange('E5').setValue('Todos'); pan.getRange('F5:H5').merge();
  pan.getRange('B5:H5').setBackground('#FFF2CC').setFontColor('#0000FF').setFontWeight('bold').setBorder(true, true, true, true, true, true, '#D9CDB4', SpreadsheetApp.BorderStyle.SOLID);
  pan.getRange('B5:C5').setNumberFormat('dd/mm/yyyy');
  pan.getRange('B5:C5').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  pan.getRange('E5').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Todos'].concat(TIPOS), true).build());

  // Auxiliar _Filtro: registros filtrados y ordenados (más recientes primero)
  fil.clear();
  fil.getRange('A1').setFormula(
    '=IFERROR(SORT(FILTER(Registros!$A$2:$T$5000,' +
    'Registros!$A$2:$A$5000<>"",' +
    'Registros!$B$2:$B$5000>=Panel!$B$5,' +
    'Registros!$B$2:$B$5000<=Panel!$C$5,' +
    '(Panel!$D$5="Todas")+(Registros!$E$2:$E$5000=Panel!$D$5)>0,' +
    '(Panel!$E$5="Todos")+(Registros!$C$2:$C$5000=Panel!$E$5)>0,' +
    'ISNUMBER(SEARCH(Panel!$F$5,Registros!$E$2:$E$5000&" "&Registros!$F$2:$F$5000&" "&Registros!$G$2:$G$5000&" "&' +
    'Registros!$H$2:$H$5000&" "&Registros!$I$2:$I$5000&" "&Registros!$J$2:$J$5000))),2,FALSE),"")');

  // Indicadores
  var k = [
    ['Combustible ($)', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,"Combustible")', '$#,##0'],
    ['Litros', '=SUMIFS(_Filtro!$K:$K,_Filtro!$C:$C,"Combustible")', '#,##0.0'],
    ['Precio prom. por litro', '=IFERROR(B8/C8,0)', '$#,##0.00'],
    ['Mantenimiento ($)', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,"Mantenimiento",_Filtro!$N:$N,"<>Pendiente")', '$#,##0'],
    ['Reparaciones ($)', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,"Reparación",_Filtro!$N:$N,"<>Pendiente")', '$#,##0'],
    ['Registros con alerta', '=COUNTIFS(_Filtro!$Q:$Q,"?*")', '0'],
    ['Pendientes por atender', '=COUNTIFS(_Filtro!$N:$N,"Pendiente")', '0']
  ];
  k.forEach(function (x, i) {
    var col = 2 + i;
    pan.getRange(7, col).setValue(x[0]).setFontSize(9).setFontColor('#FFFFFF').setBackground('#28392C').setHorizontalAlignment('center').setWrap(true);
    pan.getRange(8, col).setFormula(x[1]).setNumberFormat(x[2]).setFontSize(18).setFontWeight('bold').setFontColor('#28392C')
      .setBackground('#FBF6EC').setHorizontalAlignment('center');
  });
  pan.setRowHeight(8, 38); pan.setRowHeight(7, 30);
  pan.getRange('G8:H8').setFontColor('#9C0006');

  // Encabezados de resultados
  pan.getRange('B44').setValue('Resultados de la búsqueda (máx. 300, más recientes primero)').setFontWeight('bold').setFontSize(12).setFontColor('#28392C');
  var rh = [['Fecha', 'Tipo', 'Placas', 'Descripción de la unidad', 'Conductor', 'Concepto', 'Proveedor / estación', 'Folio',
             'Litros', 'Monto', 'Estatus', 'Alertas', 'Foto']];
  pan.getRange('B45:N45').setValues(rh).setFontWeight('bold').setBackground('#3E5742').setFontColor('#FFFFFF').setWrap(true);
  pan.getRange('B46').setFormula('=IFERROR(QUERY(_Filtro!$A:$T,"select B,C,E,F,G,H,I,J,K,M,N,Q,P where A is not null limit 300",0),"Sin resultados con estos filtros")');
  pan.getRange('B46:B345').setNumberFormat('dd/mm/yyyy');
  pan.getRange('J46:J345').setNumberFormat('0.0');
  pan.getRange('K46:K345').setNumberFormat('$#,##0.00');
  pan.getRange('M46:M345').setFontColor('#9C0006');
  [20, 90, 100, 90, 210, 140, 170, 150, 95, 70, 95, 90, 330, 70].forEach(function (w, i) { pan.setColumnWidth(i + 1, w); });
  pan.getRange('C46:N345').setVerticalAlignment('top');

  // Alertas por revisar
  pan.getRange('G26').setValue('Alertas por revisar (las 12 más recientes del filtro)').setFontWeight('bold').setFontSize(12).setFontColor('#9C0006');
  pan.getRange('G27:J27').setValues([['Fecha', 'Placas', 'Tipo', 'Alerta']]).setFontWeight('bold').setBackground('#9C0006').setFontColor('#FFFFFF');
  pan.getRange('G28').setFormula('=IFERROR(QUERY(_Filtro!$A:$T,"select B,E,C,Q where Q is not null and Q <> \'\' limit 12",0),"Sin alertas")');
  pan.getRange('G28:G39').setNumberFormat('dd/mm/yyyy');

  // Auxiliar de gráficas
  gra.clear();
  gra.getRange('A1:D1').setValues([['Placas', 'Combustible', 'Mantenimiento', 'Reparación']]);
  var rows = [];
  for (var r = 2; r <= 41; r++) {
    rows.push(['=IF(Catálogo!B' + r + '="","",Catálogo!B' + r + ')',
      '=IF($A' + r + '="","",SUMIFS(_Filtro!$M:$M,_Filtro!$E:$E,$A' + r + ',_Filtro!$C:$C,B$1,_Filtro!$N:$N,"<>Pendiente"))',
      '=IF($A' + r + '="","",SUMIFS(_Filtro!$M:$M,_Filtro!$E:$E,$A' + r + ',_Filtro!$C:$C,C$1,_Filtro!$N:$N,"<>Pendiente"))',
      '=IF($A' + r + '="","",SUMIFS(_Filtro!$M:$M,_Filtro!$E:$E,$A' + r + ',_Filtro!$C:$C,D$1,_Filtro!$N:$N,"<>Pendiente"))']);
  }
  gra.getRange(2, 1, 40, 4).setFormulas(rows);
  gra.getRange('F1:G1').setValues([['Semana', 'Combustible ($)']]);
  var wk = [];
  for (var w = 2; w <= 9; w++) {
    var e = 'Panel!$C$5-7*(8-(ROW()-1))';
    wk.push(['=TEXT(' + e + '-6,"dd/mm")&" a "&TEXT(' + e + ',"dd/mm")',
      '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,"Combustible",_Filtro!$B:$B,">="&(' + e + '-6),_Filtro!$B:$B,"<="&(' + e + '))']);
  }
  gra.getRange(2, 6, 8, 2).setFormulas(wk);
  gra.getRange('I1:J1').setValues([['Tipo', 'Monto']]);
  gra.getRange(2, 9, 3, 2).setFormulas([
    ['Combustible', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,I2)'],
    ['Mantenimiento', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,I3,_Filtro!$N:$N,"<>Pendiente")'],
    ['Reparación', '=SUMIFS(_Filtro!$M:$M,_Filtro!$C:$C,I4,_Filtro!$N:$N,"<>Pendiente")']]);
  gra.getRange('L1').setValue('Lista de unidades');
  var lst = [['Todas']];
  for (var q = 2; q <= 41; q++) lst.push(['=IF(Catálogo!B' + q + '="","",Catálogo!B' + q + ')']);
  gra.getRange(2, 12, 41, 1).setFormulas(lst.map(function (x) { return [x[0].charAt(0) === '=' ? x[0] : x[0]]; }));
  gra.getRange('L2').setValue('Todas');
  pan.getRange('D5').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(gra.getRange('L2:L42'), true).setAllowInvalid(false).build());
}

function construirGraficos() {
  var ss = SpreadsheetApp.getActive();
  var pan = ss.getSheetByName(SH.PAN), gra = ss.getSheetByName(SH.GRA), cat = ss.getSheetByName(SH.CAT);
  if (!pan || !gra) { SpreadsheetApp.getUi().alert('Primero ejecuta "Instalar / reparar estructura".'); return; }
  pan.getCharts().forEach(function (c) { pan.removeChart(c); });
  var n = 0;
  var placas = cat.getRange(2, 2, 40, 1).getValues();
  placas.forEach(function (r) { if (String(r[0]).trim() !== '') n++; });
  n = Math.max(n, 3);

  var c1 = pan.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(gra.getRange(1, 1, n + 1, 4))
    .setOption('title', 'Gasto por unidad en el periodo ($)').setOption('isStacked', true)
    .setOption('colors', ['#AD7E30', '#3E5742', '#8B4513']).setOption('legend', { position: 'bottom' })
    .setOption('width', 680).setOption('height', 300).setPosition(10, 2, 0, 0).build();
  var c2 = pan.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(gra.getRange('F1:G9'))
    .setOption('title', 'Combustible por semana ($) - últimas 8 semanas del periodo')
    .setOption('colors', ['#AD7E30']).setOption('legend', { position: 'none' })
    .setOption('width', 620).setOption('height', 300).setPosition(10, 8, 40, 0).build();
  var c3 = pan.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(gra.getRange('I1:J4'))
    .setOption('title', 'Distribución del gasto por tipo').setOption('colors', ['#AD7E30', '#3E5742', '#8B4513'])
    .setOption('pieHole', 0.45).setOption('width', 470).setOption('height', 300).setPosition(26, 2, 0, 0).build();
  pan.insertChart(c1); pan.insertChart(c2); pan.insertChart(c3);
}

function protegerHojas() {
  var ss = SpreadsheetApp.getActive();
  var me = Session.getEffectiveUser();
  [SH.REG, SH.CAT, SH.DRV, SH.USR, SH.PAR, SH.LOG, SH.PAN, SH.FIL, SH.GRA].forEach(function (name) {
    var s = ss.getSheetByName(name); if (!s) return;
    s.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    var p = s.protect().setDescription('Solo el propietario modifica esta hoja');
    if (name === SH.PAN) p.setUnprotectedRanges([s.getRange('B5:H5')]);
    p.addEditor(me);
    var ed = p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); });
    if (ed.length) p.removeEditors(ed);
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  SpreadsheetApp.getUi().alert('Hojas protegidas.\n\nDirección y Administración pueden compartirse como "Editor": solo podrán cambiar los filtros amarillos del Panel; los datos solo los escribe la app.\n\n' +
    'Nota: el propietario del archivo puede seguir editando; protege su cuenta con verificación en dos pasos.');
}

/* ===================================================================== */
/*  USUARIOS Y PIN                                                        */
/* ===================================================================== */
function agregarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var u = ui.prompt('Usuario (sin espacios, ej. yael)', ui.ButtonSet.OK_CANCEL); if (u.getSelectedButton() !== ui.Button.OK) return;
  var n = ui.prompt('Nombre completo', ui.ButtonSet.OK_CANCEL); if (n.getSelectedButton() !== ui.Button.OK) return;
  var r = ui.prompt('Rol: escribe  captura  o  admin  (admin puede ver pendientes de todos y cerrar cualquiera)', ui.ButtonSet.OK_CANCEL); if (r.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('PIN de 6 dígitos (solo números)', ui.ButtonSet.OK_CANCEL); if (p.getSelectedButton() !== ui.Button.OK) return;
  var user = u.getResponseText().trim().toLowerCase(), pin = p.getResponseText().trim(), rol = r.getResponseText().trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,20}$/.test(user)) { ui.alert('Usuario no válido.'); return; }
  if (!/^\d{6}$/.test(pin)) { ui.alert('El PIN debe tener exactamente 6 dígitos.'); return; }
  if (rol !== 'captura' && rol !== 'admin') { ui.alert('Rol no válido.'); return; }
  var s = SpreadsheetApp.getActive().getSheetByName(SH.USR);
  var last = Math.max(s.getLastRow(), 1), row = 0;
  var data = last > 1 ? s.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < data.length; i++) if (String(data[i][0]).toLowerCase() === user) { row = i + 2; break; }
  if (!row) row = last + 1;
  s.getRange(row, 1, 1, 5).setValues([[user, n.getResponseText().trim(), rol, hashPin_(user, pin), 'Sí']]);
  CacheService.getScriptCache().remove('usr_' + user); CacheService.getScriptCache().remove('fail_' + user);
  ui.alert('Usuario "' + user + '" guardado. Entrega el PIN en persona; no se puede consultar después (solo cambiar).');
}

function hashPin_(user, pin) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT');
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(user).toLowerCase() + '|' + pin, Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function findUser_(user) {
  user = String(user || '').toLowerCase();
  var cache = CacheService.getScriptCache(), key = 'usr_' + user, hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var s = SpreadsheetApp.getActive().getSheetByName(SH.USR), last = s.getLastRow(); if (last < 2) return null;
  var data = s.getRange(2, 1, last - 1, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === user) {
      var o = { user: user, name: data[i][1], role: data[i][2], hash: data[i][3], active: data[i][4] === 'Sí' };
      cache.put(key, JSON.stringify(o), 60); return o;
    }
  }
  return null;
}

function sign_(payload) {
  var sec = PropertiesService.getScriptProperties().getProperty('SECRET');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sec));
}
function makeToken_(user) {
  var p = user + '|' + (Date.now() + 12 * 3600 * 1000);
  return Utilities.base64EncodeWebSafe(p) + '.' + sign_(p);
}
function checkToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  var p; try { p = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { return null; }
  if (sign_(p) !== parts[1]) return null;
  var f = p.split('|'); if (Number(f[1]) < Date.now()) return null;
  var u = findUser_(f[0]); if (!u || !u.active) return null;
  return u;
}

/* ===================================================================== */
/*  API WEB                                                               */
/* ===================================================================== */
function doGet() {
  return json_({ ok: true, app: 'Flota Las Huertas', msg: 'API activa. Usa la app para capturar.' });
}

function doPost(e) {
  var out;
  try {
    if (!e || !e.postData || e.postData.length > 6000000) throw err_('BAD_REQUEST', 'Solicitud no válida.');
    var req = JSON.parse(e.postData.contents);
    if (req.action === 'login') { out = login_(req); }
    else {
      var u = checkToken_(req.token);
      if (!u) throw err_('AUTH', 'Sesión vencida. Vuelve a entrar.');
      var lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try {
        if (req.action === 'bootstrap') out = bootstrap_(u);
        else if (req.action === 'submit') out = submit_(u, req.record);
        else if (req.action === 'close') out = close_(u, req.data);
        else throw err_('BAD_REQUEST', 'Acción desconocida.');
      } finally { lock.releaseLock(); }
    }
  } catch (ex) {
    out = { ok: false, code: ex.code || 'ERROR', error: ex.code ? ex.message : 'Error del servidor. Intenta de nuevo.' };
    if (!ex.code) console.error(ex && ex.stack ? ex.stack : ex);
  }
  return json_(out);
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }

function log_(user, action, detail, result) {
  try { SpreadsheetApp.getActive().getSheetByName(SH.LOG).appendRow([new Date(), user, action, String(detail).slice(0, 300), result]); } catch (e) {}
}

function login_(req) {
  var user = String(req.user || '').trim().toLowerCase(), pin = String(req.pin || '');
  var cache = CacheService.getScriptCache(), fk = 'fail_' + user;
  var fails = Number(cache.get(fk) || 0);
  if (fails >= 5) { log_(user, 'login', '', 'bloqueado'); throw err_('LOCKED', 'Demasiados intentos. Espera 15 minutos o pide a Administración restablecer tu PIN.'); }
  var u = findUser_(user);
  if (!u || !u.active || u.hash !== hashPin_(user, pin)) {
    cache.put(fk, String(fails + 1), 900); log_(user, 'login', '', 'PIN incorrecto');
    throw err_('AUTH', 'Usuario o PIN incorrecto.');
  }
  cache.remove(fk); log_(user, 'login', '', 'ok');
  return { ok: true, token: makeToken_(user), name: u.name, role: u.role, user: user };
}

function params_() {
  var s = SpreadsheetApp.getActive().getSheetByName(SH.PAR), p = {};
  var d = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 2).getValues();
  d.forEach(function (r) { if (r[0]) p[r[0]] = r[1]; });
  DEFAULT_PARAMS.forEach(function (x) { if (p[x[0]] === undefined || p[x[0]] === '') p[x[0]] = x[1]; });
  return p;
}

function catalog_() {
  var s = SpreadsheetApp.getActive().getSheetByName(SH.CAT), last = s.getLastRow(), out = [];
  if (last < 2) return out;
  s.getRange(2, 1, last - 1, 10).getValues().forEach(function (r) {
    if (String(r[1]).trim() === '' || r[9] === 'Baja') return;
    out.push({ id: String(r[0]).trim(), placas: String(r[1]).trim(), marca: r[2], modelo: r[3], anio: r[4], color: r[5],
               tipo: r[6], conductor: r[7], tanque: Number(r[8]) || 0, estatus: r[9] || 'Activa' });
  });
  return out;
}

function drivers_() {
  var s = SpreadsheetApp.getActive().getSheetByName(SH.DRV), last = s.getLastRow(); if (last < 2) return [];
  return s.getRange(2, 1, last - 1, 2).getValues().filter(function (r) { return r[0] && r[1] !== 'No'; }).map(function (r) { return String(r[0]); });
}

function bootstrap_(u) {
  var p = params_();
  var par = SpreadsheetApp.getActive().getSheetByName(SH.PAR);
  var conc = par.getRange(2, 5, Math.max(par.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; }).filter(String);
  return { ok: true, catalog: catalog_(), drivers: drivers_(), conceptos: conc.length ? conc : CONCEPTOS_MANT,
           params: { fotoObligatoria: p.FOTO_TICKET_OBLIGATORIA === 'Sí', diasAtras: Number(p.DIAS_ATRAS_MAX), precioMin: Number(p.PRECIO_LITRO_MIN), precioMax: Number(p.PRECIO_LITRO_MAX) },
           pending: pending_(), serverDate: fmtDate_(new Date()), name: u.name, role: u.role };
}

function pending_() {
  var s = SpreadsheetApp.getActive().getSheetByName(SH.REG), last = s.getLastRow(), out = [];
  if (last < 2) return out;
  var from = Math.max(2, last - 1500), d = s.getRange(from, 1, last - from + 1, C.CIERRE).getValues();
  d.forEach(function (r) {
    if (r[C.ESTATUS - 1] !== 'Pendiente') return;
    out.push({ id: r[0], fecha: fmtDate_(r[C.FECHA - 1]), tipo: r[C.TIPO - 1], placas: r[C.PLACAS - 1], desc: r[C.DESC - 1],
               concepto: r[C.CONC - 1], proveedor: r[C.PROV - 1], notas: r[C.NOTAS - 1], monto: r[C.MONTO - 1] });
  });
  out.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  return out.slice(0, 100);
}

/* ---------- utilidades de validación ---------- */
function fmtDate_(d) { return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}
function today_() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0); }
function daysBetween_(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function clean_(s, max) {
  s = String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  if (/^[=+\-@]/.test(s)) s = ' ' + s;   // evita que se interprete como fórmula
  return s;
}
function num_(v) { var n = Number(v); return isFinite(n) ? n : NaN; }

function unitLabel_(u) { return [u.marca, u.modelo, u.anio, u.color].filter(function (x) { return x !== '' && x !== null; }).join(' '); }

function findRowById_(id) {
  var s = SpreadsheetApp.getActive().getSheetByName(SH.REG);
  var f = s.getRange(2, C.ID, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(id).matchEntireCell(true).matchCase(true).findNext();
  return f ? f.getRow() : 0;
}

function savePhoto_(photo, name) {
  if (!photo || !photo.b64) return '';
  if (photo.mime !== 'image/jpeg' && photo.mime !== 'image/png') throw err_('VALIDATION', 'La foto debe ser JPG o PNG.');
  var bytes = Utilities.base64Decode(photo.b64);
  if (bytes.length > 3500000) throw err_('VALIDATION', 'La foto es demasiado grande.');
  var props = PropertiesService.getScriptProperties(), fid = props.getProperty('FOLDER');
  var folder;
  try { folder = fid ? DriveApp.getFolderById(fid) : null; } catch (e) { folder = null; }
  if (!folder) {
    var file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
    var parents = file.getParents();
    var base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    folder = base.createFolder('Flota Las Huertas - Evidencias');
    props.setProperty('FOLDER', folder.getId());
  }
  var blob = Utilities.newBlob(bytes, photo.mime, name + (photo.mime === 'image/png' ? '.png' : '.jpg'));
  return folder.createFile(blob).getUrl();
}

/* ---------- registro nuevo ---------- */
function submit_(u, r) {
  if (!r || typeof r !== 'object') throw err_('VALIDATION', 'Registro vacío.');
  var id = String(r.id || '');
  if (!/^[A-Za-z0-9-]{8,40}$/.test(id)) throw err_('VALIDATION', 'Identificador no válido.');
  var sheet = SpreadsheetApp.getActive().getSheetByName(SH.REG);
  var prev = findRowById_(id);
  if (prev) return { ok: true, dup: true, id: id, row: prev, msg: 'Este registro ya estaba guardado.' };

  var p = params_();
  var tipo = String(r.type || ''); if (TIPOS.indexOf(tipo) < 0) throw err_('VALIDATION', 'Tipo de registro no válido.');
  var prog = r.mode === 'Programación';
  if (prog && tipo === 'Combustible') throw err_('VALIDATION', 'El combustible solo se registra.');
  var unit = catalog_().filter(function (c) { return c.id === String(r.unit) && c.estatus !== 'Baja'; })[0];
  if (!unit) throw err_('VALIDATION', 'La unidad no existe en el catálogo.');
  var fecha = parseDate_(r.date); if (!fecha) throw err_('VALIDATION', 'Fecha no válida.');
  var hoy = today_(), dd = daysBetween_(fecha, hoy), alertas = [];
  if (!prog) {
    if (dd < 0) throw err_('VALIDATION', 'La fecha no puede ser futura.');
    if (dd > Number(p.DIAS_ATRAS_MAX)) throw err_('VALIDATION', 'La fecha tiene más de ' + p.DIAS_ATRAS_MAX + ' días de antigüedad; pide autorización a Administración.');
    if (dd > 2) alertas.push('Captura con ' + dd + ' días de atraso');
  } else {
    if (dd > 1) throw err_('VALIDATION', 'La fecha programada no puede estar en el pasado.');
    if (dd < -365) throw err_('VALIDATION', 'La fecha programada es demasiado lejana.');
  }

  var drivers = drivers_(), driver = clean_(r.driver, 60);
  if (!driver) throw err_('VALIDATION', 'Falta el conductor.');
  if (drivers.indexOf(driver) < 0) alertas.push('Conductor no registrado en el catálogo');

  var concepto = clean_(r.concept, 80), prov = clean_(r.provider, 80), folio = clean_(r.folio, 30), notas = clean_(r.notes, 300);
  if (!concepto) throw err_('VALIDATION', 'Falta el concepto.');
  var litros = '', precio = '', monto = '';
  var hasPhoto = !!(r.photo && r.photo.b64);

  if (tipo === 'Combustible') {
    litros = num_(r.liters); monto = num_(r.amount);
    if (!(litros >= 1 && litros <= 200)) throw err_('VALIDATION', 'Litros fuera de rango (1 a 200).');
    if (!(monto >= 10 && monto <= 10000)) throw err_('VALIDATION', 'Importe fuera de rango.');
    if (folio.length < 3) throw err_('VALIDATION', 'Captura el folio del ticket.');
    if (String(p.FOTO_TICKET_OBLIGATORIA) === 'Sí' && !hasPhoto) throw err_('VALIDATION', 'La foto del ticket es obligatoria.');
    precio = Math.round(monto / litros * 100) / 100;
    if (precio < Number(p.PRECIO_LITRO_MIN) || precio > Number(p.PRECIO_LITRO_MAX)) alertas.push('Precio por litro fuera de rango ($' + precio.toFixed(2) + ')');
    if (unit.tanque && litros > unit.tanque * Number(p.FACTOR_TANQUE)) alertas.push('Litros (' + litros + ') mayores a la capacidad del tanque (' + unit.tanque + ')');
    var recent = recentFuel_(sheet, unit.id);
    var sameDay = recent.filter(function (x) { return x.fecha === fmtDate_(fecha); });
    if (sameDay.length) alertas.push('La unidad ya tiene ' + sameDay.length + ' carga(s) ese mismo día');
    var lit = recent.map(function (x) { return x.litros; }).filter(function (x) { return x > 0; }).slice(0, 10).sort(function (a, b) { return a - b; });
    if (lit.length >= 4) {
      var med = lit[Math.floor(lit.length / 2)];
      if (litros > med * Number(p.FACTOR_ATIPICO)) alertas.push('Litros atípicos: ' + litros + ' vs. mediana ' + med.toFixed(1));
    }
    if (folioExists_(sheet, folio)) alertas.push('Folio de ticket repetido');
    if (!hasPhoto) alertas.push('Sin foto del ticket');
  } else {
    monto = r.amount === '' || r.amount === null || r.amount === undefined ? '' : num_(r.amount);
    if (monto !== '' && !(monto >= 0 && monto <= 500000)) throw err_('VALIDATION', 'Monto fuera de rango.');
    if (!prog) {
      if (monto === '') throw err_('VALIDATION', 'Captura el costo total.');
      if (!folio) alertas.push('Sin folio de factura o nota');
      if (!hasPhoto) alertas.push('Sin evidencia (foto)');
      if (!prov) alertas.push('Sin proveedor / taller');
      if (monto > Number(p.UMBRAL_MONTO)) alertas.push('Monto mayor al umbral: requiere autorización de Dirección');
    } else if (monto !== '' && monto > Number(p.UMBRAL_MONTO)) alertas.push('Estimado mayor al umbral: requiere autorización previa');
    if (tipo === 'Reparación' && prog && r.priority) notas = ('Prioridad ' + clean_(r.priority, 10) + '. ' + notas).trim();
  }

  var foto = '';
  if (hasPhoto) foto = savePhoto_(r.photo, fmtDate_(fecha) + '_' + unit.placas + '_' + tipo + '_' + id.slice(0, 8));

  var row = [id, fecha, tipo, unit.id, unit.placas, unitLabel_(unit), driver, concepto, prov, folio, litros, precio, monto,
             prog ? 'Pendiente' : 'Registrado', notas, foto, alertas.join('; '), u.name, new Date(), ''];
  sheet.appendRow(row);
  log_(u.user, 'submit', tipo + ' ' + unit.placas + ' ' + id.slice(0, 8), alertas.length ? 'ok con ' + alertas.length + ' alerta(s)' : 'ok');
  return { ok: true, id: id, alerts: alertas, estatus: row[13], placas: unit.placas, precio: precio };
}

function recentFuel_(sheet, unitId) {
  var last = sheet.getLastRow(); if (last < 2) return [];
  var from = Math.max(2, last - 800), d = sheet.getRange(from, 1, last - from + 1, C.LITROS).getValues(), out = [];
  for (var i = d.length - 1; i >= 0; i--) {
    var r = d[i];
    if (r[C.TIPO - 1] === 'Combustible' && String(r[C.UNIDAD - 1]) === unitId)
      out.push({ fecha: fmtDate_(r[C.FECHA - 1]), litros: Number(r[C.LITROS - 1]) || 0 });
  }
  return out;
}
function folioExists_(sheet, folio) {
  var last = sheet.getLastRow(); if (last < 2) return false;
  var f = sheet.getRange(2, C.FOLIO, last - 1, 1).createTextFinder(folio).matchEntireCell(true).findNext();
  return !!f;
}

/* ---------- cerrar una programación ---------- */
function close_(u, d) {
  if (!d || !d.id) throw err_('VALIDATION', 'Falta el registro a cerrar.');
  var sheet = SpreadsheetApp.getActive().getSheetByName(SH.REG), row = findRowById_(String(d.id));
  if (!row) throw err_('VALIDATION', 'No se encontró el registro.');
  var cur = sheet.getRange(row, 1, 1, C.CIERRE).getValues()[0];
  if (cur[C.ESTATUS - 1] === 'Cerrado') return { ok: true, dup: true, id: d.id, msg: 'Ya estaba cerrado.' };
  if (cur[C.ESTATUS - 1] !== 'Pendiente') throw err_('VALIDATION', 'Este registro no está pendiente.');
  var p = params_(), fecha = parseDate_(d.date); if (!fecha) throw err_('VALIDATION', 'Fecha no válida.');
  var dd = daysBetween_(fecha, today_());
  if (dd < 0) throw err_('VALIDATION', 'La fecha no puede ser futura.');
  if (dd > Number(p.DIAS_ATRAS_MAX)) throw err_('VALIDATION', 'La fecha tiene más de ' + p.DIAS_ATRAS_MAX + ' días de antigüedad.');
  var monto = num_(d.amount); if (!(monto >= 0 && monto <= 500000)) throw err_('VALIDATION', 'Captura el costo total.');
  var prov = clean_(d.provider, 80) || cur[C.PROV - 1], folio = clean_(d.folio, 30), notas = clean_(d.notes, 300);
  var alertas = [];
  var prog = new Date(cur[C.FECHA - 1]);
  var retraso = daysBetween_(prog, fecha);
  if (retraso > Number(p.DIAS_PENDIENTE_ALERTA)) alertas.push('Realizado ' + retraso + ' días después de lo programado');
  if (!folio) alertas.push('Sin folio de factura o nota');
  if (!(d.photo && d.photo.b64)) alertas.push('Sin evidencia (foto)');
  if (monto > Number(p.UMBRAL_MONTO)) alertas.push('Monto mayor al umbral: requiere autorización de Dirección');
  var foto = '';
  if (d.photo && d.photo.b64) foto = savePhoto_(d.photo, fmtDate_(fecha) + '_' + cur[C.PLACAS - 1] + '_' + cur[C.TIPO - 1] + '_cierre_' + String(d.id).slice(0, 8));
  var prevAl = String(cur[C.ALERTAS - 1] || '');
  sheet.getRange(row, C.PROV).setValue(prov); sheet.getRange(row, C.FOLIO).setValue(folio);
  sheet.getRange(row, C.MONTO).setValue(monto); sheet.getRange(row, C.ESTATUS).setValue('Cerrado');
  sheet.getRange(row, C.NOTAS).setValue((String(cur[C.NOTAS - 1] || '') + (notas ? ' | Cierre: ' + notas : '')).slice(0, 400));
  if (foto) sheet.getRange(row, C.FOTO).setValue(foto);
  sheet.getRange(row, C.ALERTAS).setValue((prevAl ? prevAl + '; ' : '') + alertas.join('; '));
  sheet.getRange(row, C.CIERRE).setValue(fecha);
  log_(u.user, 'close', cur[C.TIPO - 1] + ' ' + cur[C.PLACAS - 1] + ' ' + String(d.id).slice(0, 8), 'ok');
  return { ok: true, id: d.id, alerts: alertas, estatus: 'Cerrado' };
}
