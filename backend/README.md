# pc-agent360 backend

## Propósito
API Express mínima en TypeScript para verificar la disponibilidad del backend. No persiste datos, no gestiona autenticación y no expone información personal, secretos ni trazas internas.

## Requisitos
- Node.js 20 o superior.
- npm 10 o superior.
- Un registry npm institucional JFrog configurado. Antes de instalar, compruebe `npm config get registry`; no instale si el resultado no corresponde al JFrog institucional.

## Configuración
Defina las variables en el entorno de ejecución o de despliegue. `.env.example` es una referencia sin secretos; el servicio no carga automáticamente un archivo `.env`.

| Variable | Descripción | Valor seguro por defecto |
| --- | --- | --- |
| `HOST` | Interfaz de escucha. Use `0.0.0.0` solo si el entorno lo requiere. | `127.0.0.1` |
| `PORT` | Puerto TCP del servicio. | `3000` |
| `CORS_ALLOWED_ORIGINS` | Lista separada por comas de orígenes HTTP/HTTPS permitidos. | Sin orígenes si no se configura |

Si `CORS_ALLOWED_ORIGINS` no está definido, no se autorizan solicitudes de navegador de origen cruzado. Las solicitudes sin cabecera `Origin`, como las comprobaciones locales de disponibilidad, continúan disponibles.

## Comandos
```powershell
npm config get registry
npm install
npm run dev
npm run typecheck
npm run build
npm start
```

`npm install` debe ejecutarse únicamente cuando el registry mostrado sea el institucional JFrog. Todas las versiones declaradas son exactas y `npm install` generará el `package-lock.json` coherente desde ese registry.

## Endpoint
### `GET /api/v1/health`
Responde `200 OK` cuando el proceso está disponible:

```json
{
  "status": "UP",
  "service": "pc-agent360-backend",
  "correlationId": "f7f37666-1f56-4d06-a26e-4748d7b4da3e"
}
```

La API acepta una cabecera `X-Correlation-ID` UUID v4 válida y la devuelve sin cambios. Cuando no existe o no es válida, genera un UUID v4 seguro. Las respuestas `404` y de error también incluyen el identificador, pero nunca exponen trazas ni detalles internos.

## Contrato API

[`openapi/openapi.yaml`](./openapi/openapi.yaml) es la fuente de verdad para `GET /api/v1/health`. Mantenga el contrato y la implementación compatibles ante cualquier cambio.

## Arquitectura
- `src/config.ts`: valida la configuración de entorno.
- `src/app.ts`: compone seguridad HTTP, CORS, JSON limitado, rutas y manejadores.
- `src/middleware/`: gestiona trazabilidad y respuestas de error seguras.
- `src/logger.ts`: emite únicamente eventos JSON estructurados sin datos sensibles mediante stdout.
- `src/server.ts`: inicia el servidor y realiza apagado ordenado ante `SIGINT` y `SIGTERM`.

La capa HTTP no contiene lógica de negocio ni acceso directo a datos.

## Tecnologías
Express, Helmet, CORS y TypeScript.

## Autores
Equipo pc-agent360.
