# Flota Las Huertas

App móvil (PWA) para capturar en segundos la bitácora de **14 vehículos y 4 motocicletas** de Panadería Las Huertas
y subirla a una **matriz en Google Sheets** (en el Drive de la empresa) con panel de búsqueda, filtros y gráficas.

Sin odómetro: solo se registra **combustible del día**, **mantenimiento** y **reparaciones**
(registrar lo ya hecho o programar lo pendiente). De cada unidad solo se guarda: últimos 5 de la serie, placas, marca, modelo, año y color.

```
Celular (app en GitHub Pages)  ──PIN──►  Apps Script (valida y alerta)  ──►  Google Sheets + Drive (fotos)
        ▲  cola sin señal                                                      └─ Panel: periodo, filtros, búsqueda, gráficas
```

## Qué hace la app
1. **Inicio**: 4 botones: Combustible del día · Mantenimiento · Reparación · Pendientes.
2. **Formulario**: eliges unidad (una lista), conductor (se propone el habitual), fecha y los datos del tipo. Mantenimiento y Reparación tienen el interruptor **Registrar (ya se hizo) / Programar (pendiente)**.
3. **Confirmar**: resumen de lo capturado antes de subir. Al subir, aparece la confirmación y la opción **Borrar formulario y registrar otro**, **Conservar datos** o **Ir al inicio**. El botón **Borrar formulario** siempre está disponible.
4. **Pendientes**: lo programado se cierra después con costo, folio y foto.
5. **Sin señal**: el registro se guarda en el teléfono y se envía solo al volver la conexión (sin duplicarse).

## Qué hace el Panel (hoja "Panel" del archivo de Drive)
Filtros amarillos: **Desde / Hasta, Unidad, Tipo y Buscar texto** (conductor, concepto, folio, proveedor…).
Todo se recalcula: indicadores (gasto de combustible, litros, precio promedio por litro, mantenimiento, reparaciones, alertas, pendientes), tres gráficas (gasto por unidad, combustible por semana, distribución por tipo), lista de alertas y tabla de resultados (hasta 300 renglones).

## Seguridad y control (resumen)
- **PIN de 6 dígitos por persona**, guardado cifrado (SHA-256 con sal). 5 intentos fallidos bloquean 15 min. Sesión de 12 h; la app vuelve a pedir PIN tras 15 min en segundo plano.
- La app **solo agrega**: nadie puede editar ni borrar registros desde el celular. Hojas protegidas; Dirección y Administración pueden ser "Editor" y solo podrán mover los filtros amarillos del Panel.
- Cada envío lleva un identificador único: un reintento nunca duplica. Todo acceso y envío queda en la hoja **Bitácora**.
- Validación en el servidor (no solo en el celular): unidad y fecha válidas (no futuras ni de hace más de 7 días), rangos de litros e importe, texto saneado contra fórmulas.
- **Alertas automáticas** para el auditor (columna "Alertas"): precio por litro fuera de rango, litros mayores al tanque, litros atípicos vs. la mediana de la unidad, dos cargas el mismo día, folio de ticket repetido, conductor no registrado, captura atrasada, gasto sobre el umbral sin autorización, sin folio o sin foto.
- **Foto del ticket obligatoria** en combustible (se guarda en una carpeta de Drive). Como no hay odómetro, la foto + folio único + comparación contra la mediana de la unidad sustituyen al rendimiento km/l.
- El repositorio no contiene datos ni contraseñas; la URL del Apps Script sin PIN no devuelve información.

## Instalación (≈30 minutos)

### A. Archivo matriz en Drive
1. En Google Drive crea una **Hoja de cálculo** nueva: "Flota Las Huertas - Matriz".
2. Menú **Extensiones > Apps Script**. Borra el código de ejemplo y pega todo `apps-script/Code.gs`.
   En **Configuración del proyecto** activa "Mostrar el archivo de manifiesto appsscript.json" y pega el contenido de `apps-script/appsscript.json`.
3. Guarda y ejecuta la función **`instalar`** (la primera vez Google pide permisos: Revisar permisos > tu cuenta > Avanzado > Continuar). Crea las hojas Panel, Registros, Catálogo, Conductores, Usuarios, Parámetros y Bitácora.

### B. Datos maestros y usuarios
4. **Catálogo**: una fila por unidad (serie últimos 5, placas, marca, modelo, año, color, tipo, conductor habitual, tanque en litros). Borra la fila de ejemplo.
5. **Conductores**: un nombre por fila.
6. Recarga la hoja y usa el menú **Flota Las Huertas > Agregar o cambiar usuario** para cada persona (usuario, nombre, rol, PIN). Entrega el PIN en persona.
7. Menú **Flota Las Huertas > Actualizar gráficos** (también cada vez que agregues unidades).
8. **Parámetros**: revisa los valores amarillos (rango de precio por litro, umbral de autorización, días hacia atrás permitidos…). Son supuestos iniciales; ajústalos.

### C. Publicar el servidor
9. En Apps Script: **Implementar > Nueva implementación > Aplicación web**. *Ejecutar como*: **Yo**. *Quién tiene acceso*: **Cualquier persona**. Implementar y copia la URL que termina en `/exec`.
10. Menú **Flota Las Huertas > Proteger hojas**. Comparte el archivo (Editor) con Dirección y Administración, y comparte la carpeta de Drive "Flota Las Huertas - Evidencias" (se crea con la primera foto) en modo lectura.

### D. Publicar la app (GitHub Pages)
11. Sube este repositorio a GitHub. En **Settings > Pages**: *Source* = rama `main`, carpeta **/docs**.
12. Edita `docs/config.js` y pega la URL del paso 9 en `API_URL`. Haz commit.
13. En el celular abre la dirección de Pages (`https://<usuario>.github.io/<repositorio>/`) y usa **Agregar a pantalla de inicio** (Chrome: menú ⋮; iPhone: Compartir).

> Con `API_URL` vacío la app corre en **modo demo** (usuario `demo`, PIN `123456`, datos solo en el teléfono) para enseñarla sin tocar Drive.

## Lista de verificación después de instalar
- [ ] Entrar con tu usuario desde el celular y registrar una carga de prueba con foto → aparece en **Registros** y en el **Panel**.
- [ ] Programar un mantenimiento → aparece en **Pendientes** y se cierra desde la app.
- [ ] Cambiar el filtro de unidad / fechas en el Panel → indicadores y gráficas cambian.
- [ ] Enviar una carga con un folio repetido → sale alerta en la columna "Alertas".
- [ ] Apagar los datos del celular, capturar, volver a prender → se sube solo.
- [ ] Borrar los registros de prueba de la hoja Registros (como propietario).

## Mantenimiento
- **Nueva unidad o conductor**: agregarlo en Catálogo / Conductores; en la app, "Actualizar unidades y conductores". Luego Actualizar gráficos.
- **Cambiar un PIN o bloquear a alguien**: menú de usuarios, o poner "No" en la columna Activo de la hoja Usuarios.
- **Nueva versión de la app**: cambia el archivo en GitHub; si cambias `app.js` o `app.css` sube también `CACHE` en `docs/sw.js` (ej. `flota-huertas-v2`).
- **Nueva versión del servidor**: pega el nuevo `Code.gs` y en Implementar > Administrar implementaciones > Editar > Nueva versión.
- El archivo guarda hasta 5,000 renglones en Registros (varios años con 18 unidades). Para archivar, copia el archivo cada año.

## Límites conocidos
- La fecha y hora de captura vienen del servidor; la **fecha del evento** la elige quien captura (máx. 7 días atrás, ajustable). Un chofer podría registrar una carga que no hizo: por eso existen la foto, el folio único, las alertas y la **verificación sorpresa por parte de Administración** contra los tickets y el reporte de la tarjeta o vales.
- El propietario del archivo de Google puede editar todo; protege esa cuenta con verificación en dos pasos.
- Las fotos se reducen a ~1280 px para subir rápido con datos móviles.

## Estructura del repositorio
```
docs/            App (GitHub Pages): index.html, app.js, app.css, config.js, sw.js, demo.js, assets/
apps-script/     Code.gs (servidor y panel) + appsscript.json
```
