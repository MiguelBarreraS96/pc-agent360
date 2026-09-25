# pc-agent360 backend

## Descripción
API Express en TypeScript para autenticación mediante Firebase Email Link, sesiones opacas y control de acceso por roles. El frontend presenta un Firebase ID token solo a `POST /api/v1/auth/session`; el backend lo valida con Firebase Admin, consulta la whitelist en Firestore y emite una cookie de sesión `HttpOnly`. No persiste tokens Firebase, refresh tokens, cookies ni datos personales en logs.

## Ruta API
Todas las operaciones están versionadas con el prefijo `/api/v1`. El contrato fuente de verdad es [`openapi/openapi.yaml`](./openapi/openapi.yaml).

## Seguridad y flujo de sesión
1. Firebase autentica el correo con Email Link y el cliente conserva el ID token únicamente en memoria.
2. `POST /api/v1/auth/session` verifica ese bearer token con Firebase Admin y credenciales por defecto de Cloud Run.
3. Solo un usuario activo de `users` obtiene una sesión. Firestore almacena hashes SHA-256 del secreto de sesión y del token CSRF; nunca sus valores originales.
4. La cookie de sesión dura como máximo una hora. La inactividad se configura con `SESSION_INACTIVITY_TIMEOUT_SECONDS` y comienza en 900 segundos.
5. `POST /api/v1/auth/session/bootstrap` exige la cookie y un encabezado `Origin` exactamente incluido en `CORS_ALLOWED_ORIGINS`. Rota el CSRF persistido sin renovar la expiración absoluta ni la actividad y responde `Cache-Control: no-store`.
6. `GET /api/v1/auth/me` solo resuelve la sesión, usuario, rol y permisos vigentes; no registra actividad.
7. Las mutaciones autenticadas, salvo `POST /api/v1/auth/session/bootstrap`, requieren `X-CSRF-Token`. El middleware valida primero el token y solo después registra actividad. `POST /api/v1/auth/activity` permite registrar actividad explícitamente con el mismo control CSRF. Bootstrap usa el `Origin` exacto como protección y la creación de sesión no exige CSRF porque todavía no existe una cookie.
8. Cada CRUD de `/api/v1/admin/users` y `/api/v1/admin/roles` requiere simultáneamente el rol protegido `ADMIN` y el permiso específico. Un rol personalizado conserva sus permisos funcionales, pero no puede obtener administración por asignación o edición.
9. Las desactivaciones, cambios de rol y eliminaciones de usuarios se serializan en una transacción de Firestore con un documento de bloqueo dedicado; nunca pueden retirar concurrentemente al último `ADMIN` activo.
10. Los endpoints de autenticación usan un límite en memoria por IP y devuelven `429` con `Retry-After`. Esta defensa por instancia se complementa en producción con rate limiting de gateway o Cloud Armor.

Las cookies son `HttpOnly`, usan `Secure` obligatoriamente en producción y `SameSite` configurable. CORS permite credenciales solo desde orígenes explícitos. No use comodines ni HTTP en producción.

## Requisitos
- Node.js 20 o superior y npm 10 o superior.
- Una base de datos Firestore (modo nativo) en el proyecto de GCP configurado.
- Cuenta de servicio de Cloud Run con Application Default Credentials y privilegios mínimos para verificar Firebase ID tokens y leer/escribir Firestore (`roles/datastore.user`).
- Firebase Authentication con Email Link configurado fuera de este repositorio.
- Registro institucional JFrog con las dependencias aprobadas.

## Configuración
El proceso valida la configuración al iniciar. `npm run dev` y `npm run seed` cargan `backend/.env` automáticamente vía `node --env-file=.env` (Node 20.6+); `.env` está en `.gitignore` y nunca debe contener secretos reales, solo configuración pública de este entorno. `npm run build`/`npm start` (imagen de producción) **no** cargan `.env`: Cloud Run inyecta las variables directamente como protegidas. `.env.example` contiene únicamente referencias sin secretos.

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `NODE_ENV` | No | `development`, `test` o `production`; producción exige CORS HTTPS. |
| `HOST` / `PORT` | No | Host de escucha y puerto; Cloud Run inyecta `PORT`. |
| `FIREBASE_PROJECT_ID` | No | Proyecto Firebase/GCP si ADC no lo deduce (`GOOGLE_CLOUD_PROJECT` sirve como respaldo). No use archivos JSON de claves. |
| `FIRESTORE_DATABASE_ID` | No | Identificador de la base de datos Firestore con nombre; por defecto `(default)`. |
| `CORS_ALLOWED_ORIGINS` | Sí en producción | Lista separada por comas de orígenes exactos HTTPS; también se valida en `POST /auth/session/bootstrap`. |
| `SESSION_COOKIE_NAME` | No | Nombre de la cookie; por defecto `agent360_session`. |
| `SESSION_COOKIE_SAME_SITE` | No | `lax`, `strict` o `none`; `none` solo es válido con cookie segura de producción. |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | No | Entre 60 y 3600; por defecto 900. |
| `BOOTSTRAP_ADMIN_EMAIL` | Para siembra inicial | Correo del administrador inicial, usado solo por `npm run seed`. |

## Siembra de Firestore
Ejecute `npm run seed` ([`scripts/seed-firestore.mjs`](./scripts/seed-firestore.mjs)) una vez contra el proyecto/base de datos objetivo antes de usar instancias nuevas. El script es idempotente: crea o actualiza los roles protegidos `USER` y `ADMIN` y, si `BOOTSTRAP_ADMIN_EMAIL` está definido en el entorno, crea o reactiva ese correo como administrador inicial.

```powershell
$env:GOOGLE_CLOUD_PROJECT = "sb-dominique-ai"
$env:FIRESTORE_DATABASE_ID = "pc-agent-360"
$env:BOOTSTRAP_ADMIN_EMAIL = "<correo-administrador-autorizado>"
npm run seed
```

El rol `USER` solo tiene `agent:read`. `ADMIN` tiene `agent:read`, `emails:manage`, `products:read`, `products:write`, `reports:read`, `users:read`, `users:write`, `roles:read` y `roles:write`. Los roles protegidos no pueden modificarse ni eliminarse por API; los roles personalizados aceptan únicamente esta allowlist de permisos. Los permisos no sustituyen el rol `ADMIN` en las rutas administrativas.

`reports:read` habilita el reporte administrativo de consultas de Cliente 360 (`/api/v1/admin/reports/consultations/*`): consultar totales por rango de fechas y descargar el detalle en CSV o XML. Requiere además el rol `ADMIN`, igual que Productos.

## Endpoints
| Método | Ruta | Autorización |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Pública |
| `POST` | `/api/v1/auth/session` | Firebase bearer token |
| `POST` | `/api/v1/auth/session/bootstrap` | Sesión y `Origin` exacto permitido; rota CSRF sin registrar actividad |
| `GET` | `/api/v1/auth/me` | Sesión; no registra actividad |
| `POST` | `/api/v1/auth/activity` | Sesión y CSRF; registra actividad tras validar CSRF |
| `POST` | `/api/v1/auth/session/refresh` | Sesión, CSRF y Firebase bearer token |
| `POST` | `/api/v1/auth/logout` | Sesión y CSRF |
| `GET`, `POST` | `/api/v1/admin/users` | Rol `ADMIN` y `users:read` / `users:write` (+ CSRF en POST) |
| `GET`, `PATCH`, `DELETE` | `/api/v1/admin/users/{userId}` | Rol `ADMIN` y `users:read` / `users:write` (+ CSRF en mutaciones) |
| `GET`, `POST` | `/api/v1/admin/roles` | Rol `ADMIN` y `roles:read` / `roles:write` (+ CSRF en POST) |
| `GET`, `PATCH`, `DELETE` | `/api/v1/admin/roles/{roleId}` | Rol `ADMIN` y `roles:read` / `roles:write` (+ CSRF en mutaciones) |
| `GET` | `/api/v1/admin/reports/consultations/summary` | Rol `ADMIN` y `reports:read`; totales de consultas de Cliente 360 por rango de fechas (`desde`, `hasta`) |
| `GET` | `/api/v1/admin/reports/consultations/export` | Rol `ADMIN` y `reports:read`; descarga CSV/XML con una fila por consulta (`desde`, `hasta`, `formato`); 422 si supera 100.000 filas |

Ejemplo de creación de sesión exitoso, sin revelar el secreto de cookie:

```json
{
  "user": {
    "id": "7e2a179f-c9a3-4be2-b7f1-faf8d1ca3c75",
    "email": "usuario@example.com",
    "displayName": null,
    "isActive": true,
    "role": {
      "id": "e0b9e42a-bafb-4f7a-a43f-0a0cf48dc09e",
      "key": "USER",
      "name": "Usuario",
      "description": "Acceso exclusivo al Agente IA.",
      "isProtected": true,
      "permissions": ["agent:read"]
    }
  },
  "csrfToken": "token-opaco-solo-de-ejemplo",
  "expiresAt": "2026-01-01T01:00:00.000Z"
}
```

Las respuestas de error incluyen solo un código, mensaje genérico y `correlationId`; nunca incluyen trazas, correo, token, cookie ni detalles de Firestore/Firebase.

## Arquitectura
- `src/config.ts`: validación fail-fast e inmutable de entorno y límites.
- `src/database/firestore.ts`: cliente Firestore compartido; los repositorios ejecutan transacciones nativas para toda operación que requiera atomicidad.
- `src/firebase-app.ts`: inicialización idempotente de la app de Firebase Admin, reutilizada por Firebase Auth y por Firestore.
- `src/auth/`: Firebase Admin, emisión y revocación de sesiones, cookies, CSRF, validación estricta de origen y middleware de autenticación.
- `src/access/`: modelos, validación estricta Zod, repositorios, servicios, permisos, control de rol `ADMIN` y rutas administrativas.
- `src/middleware/`: correlación y errores genéricos sin datos sensibles.
- `src/composition.ts`: inyección de adaptadores y servicios en la capa HTTP.
- `scripts/seed-firestore.mjs`: siembra idempotente de roles protegidos y del administrador inicial, ejecutada manualmente contra el proyecto objetivo.

El apagado ante `SIGINT` y `SIGTERM` deja de aceptar solicitudes y cierra el cliente Firestore. Los eventos estructurados contienen únicamente correlación, estado y metadatos operativos seguros.

## Desarrollo y validación
No ejecute instalaciones contra npm público. Las dependencias nuevas están declaradas con versiones exactas en `package.json`, pero `package-lock.json` se conserva intencionalmente sin cambios por esta entrega. Antes de compilar o desplegar, el equipo debe resolver y regenerar el lockfile exclusivamente desde JFrog; hasta entonces `npm ci`, Docker y la validación completa no son reproducibles.

Cuando JFrog esté configurado y el lockfile se haya actualizado en una revisión aprobada:

```powershell
npm ci
npm run typecheck
npm run build
npm start
```

Use [`postmanCollections/firebase-authentication.postman_collection.json`](./postmanCollections/firebase-authentication.postman_collection.json) con un Firebase ID token de corta vida obtenido en un entorno autorizado. Postman conserva la cookie en su cookie jar y guarda el CSRF solo como variable local de colección.

## Despliegue
`npm run deploy` exige configuración explícita antes de invocar Cloud Run. Defina solo referencias y valores no secretos en el ambiente:

| Variable local de despliegue | Uso |
| --- | --- |
| `CORS_ALLOWED_ORIGIN` | Un origen HTTPS exacto del frontend para este ambiente. |
| `FIREBASE_PROJECT_ID` | Proyecto Firebase que valida Firebase Admin y resuelve Firestore. |
| `SESSION_COOKIE_SAME_SITE` | Política explícita `lax`, `strict` o `none`. |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | Entero entre 60 y 3600. |

El script nunca recibe credenciales en texto plano; Firestore no requiere una cadena de conexión ni un secreto, solo las credenciales por defecto de Cloud Run con permisos de Firestore. Puede validar entradas sin desplegar con `node scripts/deploy.mjs --dry-run`.

## Tecnologías
Node.js 20+, Express 4.21.2, Firebase Admin 13.0.2 (Auth + Firestore), Zod 3.24.2, Helmet y CORS.

## Autores
Equipo pc-agent360.
