/**
 * Configuración de entorno para desarrollo.
 * `apiBaseUrl` apunta al backend propio (BFF), que por defecto corre en
 * http://localhost:3000 (ver backend/.env.example, PORT=3000).
 */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',
} as const;
