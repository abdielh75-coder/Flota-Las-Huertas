// CONFIGURACIÓN DE LA APP
// 1) Después de implementar el Apps Script como "Aplicación web", pega aquí su URL (termina en /exec).
// 2) Mientras API_URL esté vacío, la app corre en MODO DEMO (datos de prueba en el propio teléfono, no se sube nada).
window.FLOTA_CONFIG = {
  API_URL: "",
  IDLE_LOCK_MINUTES: 15   // si la app queda en segundo plano más de este tiempo, vuelve a pedir PIN
};
