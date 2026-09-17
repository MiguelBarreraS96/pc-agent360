/**
 * Configuración de entorno para producción.
 * `apiBaseUrl` apunta al backend propio (BFF) desplegado en Cloud Run.
 * Este archivo reemplaza a `environment.ts` durante el build de producción
 * mediante `fileReplacements` en angular.json.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://bk-agent360-375497346421.us-central1.run.app',
} as const;
