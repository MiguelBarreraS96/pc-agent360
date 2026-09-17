# pc-agent360 backend

## Propósito
API Express mínima en TypeScript para verificar la disponibilidad del backend. No persiste datos, no gestiona autenticación y no expone información personal, secretos ni trazas internas.

## Requisitos
- Node.js 20 o superior y npm 10 o superior para desarrollo local.
- Google Cloud CLI con acceso autorizado al proyecto de despliegue.
- Una configuración del registry institucional de dependencias disponible externamente al repositorio para la etapa de build.

La compilación desde fuente ejecuta `npm ci` dentro del Dockerfile. El entorno de build debe contar externamente con el acceso aprobado al registry institucional; este repositorio no incluye `.npmrc`, URL, token ni credenciales, y no debe habilitarse ningún fallback a npm público. Antes del primer build remoto, el `package-lock.json` existente debe validarse o regenerarse desde ese registry institucional para eliminar cualquier URL resuelta de un origen público.

## Configuración
Defina las variables en el entorno de ejecución o de despliegue. `.env.example` es una referencia sin secretos; el servicio no carga automáticamente un archivo `.env`.

| Variable | Valor inicial en Cloud Run | Descripción |
| --- | --- | --- |
| `NODE_ENV` | `production` | Activa la configuración de ejecución de producción. |
| `HOST` | `0.0.0.0` | Permite que el contenedor escuche las solicitudes de Cloud Run. |
| `GOOGLE_CLOUD_PROJECT` | `sb-dominique-ai` | Identificador no secreto del proyecto de despliegue. |
| `FIRESTORE_DATABASE_ID` | `pc-agent-360` | Identificador no secreto reservado para una integración futura; Firestore aún no está implementado. |
| `PORT` | Inyectado por Cloud Run (`8080`) | No se define en el Dockerfile, `.env.example` ni en el script de despliegue. |
| `CORS_ALLOWED_ORIGINS` | Sin configurar | Debe permanecer ausente hasta conocer el dominio HTTPS exacto del frontend. No use `*`. |

Si `CORS_ALLOWED_ORIGINS` no está definido, no se autorizan solicitudes de navegador de origen cruzado. Las solicitudes sin cabecera `Origin`, como las comprobaciones de disponibilidad, continúan disponibles.

## Despliegue inicial en Cloud Run
El servicio de Cloud Run se llama `bk-agent360`, se despliega desde `backend/` y usa el proyecto `sb-dominique-ai` en la región `us-central1`.

Una vez que el entorno remoto de build tenga disponible el acceso institucional aprobado para dependencias, ejecute solamente:

```powershell
npm run deploy
```

El comando de despliegue sube el código fuente a Cloud Run, que usa este Dockerfile y ejecuta `npm ci` durante el build remoto. No es necesario ejecutar `npm ci` localmente para lanzar el despliegue desde fuente.

El script `deploy` ejecuta exactamente:

```powershell
gcloud run deploy bk-agent360 --source . --project=sb-dominique-ai --region=us-central1 --port=8080 --allow-unauthenticated --ingress=all --cpu=1 --memory=512Mi --timeout=15s --concurrency=80 --min-instances=0 --max-instances=2 --set-env-vars=NODE_ENV=production,HOST=0.0.0.0,GOOGLE_CLOUD_PROJECT=sb-dominique-ai,FIRESTORE_DATABASE_ID=pc-agent-360
```

El Dockerfile usa una compilación multi-stage: compila TypeScript en una etapa aislada y deja en runtime solo dependencias de producción y `dist/`. El proceso se ejecuta como el usuario no root `node`, con `NODE_ENV=production`, `HOST=0.0.0.0`, el puerto expuesto `8080` y el comando `node dist/server.js`.

`--allow-unauthenticated` y `--ingress=all` dejan el backend público temporalmente para este despliegue inicial. Antes de exponer cualquier endpoint que procese o entregue datos, se debe retirar el acceso público o restringirlo y configurar autenticación y autorización institucionales.

## Endpoint
### `GET /api/v1/health`
Una vez desplegado, consulte el endpoint en:

```text
https://<URL-asignada-por-Cloud-Run>/api/v1/health
```

Responde `200 OK` cuando el proceso está disponible:

```json
{
  "status": "UP",
  "service": "pc-agent360-backend",
  "correlationId": "f7f37666-1f56-4d06-a26e-4748d7b4da3e"
}
```

La API acepta una cabecera `X-Correlation-ID` UUID v4 válida y la devuelve sin cambios. Cuando no existe o no es válida, genera un UUID v4 seguro. Las respuestas `404` y de error también incluyen el identificador, pero nunca exponen trazas ni detalles internos.

## Desarrollo y validación local
```powershell
npm ci
npm run dev
npm run typecheck
npm run build
npm start
```

Ejecute `npm ci` únicamente cuando el entorno tenga configurado el registry institucional aprobado. El archivo `package-lock.json` se conserva para instalaciones reproducibles.

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
