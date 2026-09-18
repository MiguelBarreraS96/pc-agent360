# Frontend Agente 360

Aplicación Angular standalone de Agente 360. Implementa acceso con Firebase Email Link, sesión respaldada por cookie `HttpOnly`, navegación lazy protegida por permisos y administración de whitelist/roles mediante `/api/v1`.

## Alcance implementado

- Firebase Email Link con `inMemoryPersistence`; no usa `localStorage` ni persiste ID tokens, refresh tokens, CSRF o sesiones.
- Intercambio puntual del Firebase ID token por `POST /api/v1/auth/session`.
- Restauración mediante `POST /api/v1/auth/session/bootstrap`: la cookie se valida y el backend entrega un CSRF nuevo solo en memoria. El navegador envía su `Origin` real; no se extiende ni la expiración absoluta ni la inactividad.
- Cierre por inactividad configurable. Los eventos reales de usuario envían `POST /api/v1/auth/activity` con CSRF para actualizar actividad de forma explícita; los `GET` no mantienen viva la sesión.
- Interceptor funcional limitado al origen API configurado: añade `withCredentials`, UUID v4 de correlación y CSRF solo cuando corresponde.
- Guards de sesión y permisos para UX; el backend conserva la autoridad de autorización.
- Shell con Agente IA para usuarios autorizados y Correos conectados/Productos exclusivamente para `ADMIN` con sus permisos vigentes.
- CRUD de whitelist y roles/permisos en Correos conectados. Productos y Agente IA son vistas seguras sin datos reales ni CRUD adicional.

## Dependencias y lockfile institucional

| Paquete | Versión | Uso |
| --- | ---: | --- |
| `firebase` | `11.0.2` | Firebase Email Link web SDK |
| `bootstrap-icons` | `1.11.3` | Iconografía local compilada |
| `tailwindcss` | `3.4.17` | Utilidades y capas CSS compiladas |
| `postcss` | `8.4.49` | Procesamiento CSS |
| `autoprefixer` | `10.4.20` | Prefijos CSS de compilación |

`package-lock.json` debe regenerarse exclusivamente desde el JFrog institucional antes de usar `npm ci` o crear la imagen. No use npm público como fallback.

## Configuración pública de runtime

`public/assets/runtime-config.json` contiene ejemplos inválidos intencionalmente y el cargador los rechaza. La imagen de producción genera ese archivo al iniciar desde `runtime-config.template.json`; si falta alguna variable, el contenedor falla antes de servir la SPA.

Variables públicas obligatorias en Cloud Run:

| Variable | Formato |
| --- | --- |
| `API_ORIGIN` | Origen HTTPS exacto del backend, sin `/` final |
| `API_BASE_URL` | Debe ser exactamente `${API_ORIGIN}/api/v1` |
| `EMAIL_LINK_CONTINUE_URL` | URL HTTPS que termina en `/auth/email-link` |
| `FIREBASE_API_KEY` | Configuración pública de Firebase Web |
| `FIREBASE_APP_ID` | Configuración pública de Firebase Web |
| `FIREBASE_AUTH_DOMAIN` | Host de Firebase Auth sin protocolo ni ruta |
| `FIREBASE_PROJECT_ID` | Identificador público de proyecto Firebase |
| `INACTIVITY_TIMEOUT_SECONDS` | Entero entre `60` y `3600`; debe coincidir con backend |

No incluya cuentas de servicio, tokens, credenciales PostgreSQL, correos bootstrap ni secretos en estas variables o en el bundle. La URL de Email Link debe estar autorizada en Firebase y el origen de la SPA debe estar en `CORS_ALLOWED_ORIGINS` del backend.

`npm run deploy` valida estas variables y las inyecta en Cloud Run. Antes de ejecutar el despliegue, cárguelas desde la configuración protegida del ambiente; puede verificar la forma sin desplegar con `node scripts/deploy.mjs --dry-run`.

## Integración con backend

| Operación | Contrato consumido |
| --- | --- |
| Crear sesión | `POST /api/v1/auth/session` con `Authorization: Bearer <Firebase ID token>` en memoria |
| Restaurar sesión | `POST /api/v1/auth/session/bootstrap` con cookie y `Origin` exacto; entrega CSRF en memoria |
| Registrar actividad | `POST /api/v1/auth/activity` con cookie y CSRF |
| Renovar sesión | `POST /api/v1/auth/session/refresh` con cookie, CSRF y Firebase token en memoria |
| Cerrar sesión | `POST /api/v1/auth/logout` con cookie y CSRF |
| Whitelist | `GET/POST/PATCH/DELETE /api/v1/admin/users` para `ADMIN` |
| Roles | `GET/POST/PATCH/DELETE /api/v1/admin/roles` para `ADMIN` |

La cookie nunca se lee desde TypeScript. El CSRF vive únicamente en un signal privado de memoria y se rota en creación, bootstrap o renovación. Los errores mostrados son genéricos; no se registran tokens, correos, cookies ni prompts.

## Rutas

| Ruta | Acceso |
| --- | --- |
| `/login` | Pública; solicita Email Link |
| `/auth/email-link` | Pública; confirma el correo y crea la sesión backend |
| `/agent` | Sesión con `agent:read` |
| `/correos-conectados` | Rol protegido `ADMIN` con permisos administrativos |
| `/productos` | Rol protegido `ADMIN` con `products:read` |

## Tailwind, CSP y Nginx

Tailwind se compila con `tailwind.config.js` y `postcss.config.js`; no hay CDNs. Bootstrap Icons se importa desde el paquete local. Nginx se renderiza al iniciar el contenedor para incluir solo `API_ORIGIN` y hosts HTTPS concretos de Firebase en CSP. No use comodines en `connect-src`, `script-src` o `frame-src`.

`runtime-config.json` se sirve con `Cache-Control: no-store`; source maps y la plantilla de runtime no son públicos. Se conservan HSTS, `nosniff`, protección anti-frame, Referrer-Policy y Permissions-Policy.

## Compilación y despliegue

Requisitos: Node.js 20 LTS+, npm 10+ y acceso al JFrog institucional. Tras regenerar los lockfiles aprobados:

```text
npm ci
npm run typecheck
npm run build
```

El Dockerfile compila el bundle y Nginx sirve `dist/frontend/browser` en el puerto `8080`. El contenedor requiere las variables runtime anteriores; un despliegue sin ellas falla de forma segura. El endpoint operativo es `GET /healthz`.

## Estructura relevante

```text
src/app/
  core/                         Configuración, Firebase, sesión, interceptor, guards y API tipada
  features/auth/                Login y callback de Firebase Email Link
  features/shell/               Navegación protegida por permisos
  features/agent/               Placeholder seguro de Agente IA
  features/admin/               Whitelist, roles/permisos y Productos
public/assets/runtime-config.template.json  Plantilla pública inyectada por ambiente
```
