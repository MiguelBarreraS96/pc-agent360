# Diseño — Autenticación Firebase y control de accesos

## Decisión de autenticación

Se utiliza Firebase Email Link como primer proveedor. Es compatible con whitelist basada en correo corporativo y evita contraseñas locales. El proveedor queda aislado para añadir Firebase Phone OTP posteriormente sin cambiar la autorización del backend.

## Flujo de sesión

```text
Angular -> Firebase Email Link -> Firebase ID token en memoria
Angular -- Authorization: Bearer <ID token> --> POST /api/v1/auth/session
Express -> Firebase Admin verifica ID token -> PostgreSQL busca usuario activo
Express -> cookie de sesión opaca + CSRF efímero -> Angular
Angular -- cookie + X-CSRF-Token --> APIs protegidas
```

1. El cliente solicita el enlace con Firebase y no persiste correo ni tokens en almacenamiento local.
2. Tras completar Email Link, Angular presenta el ID token en memoria una sola vez al backend.
3. El backend verifica el token, exige correo verificado, normaliza el correo y resuelve un usuario activo de whitelist.
4. PostgreSQL almacena hashes SHA-256 de la sesión y CSRF, con expiración máxima de una hora y última actividad.
5. Tras una recarga, Angular usa `POST /api/v1/auth/session/bootstrap`; el backend exige cookie y `Origin` exacto permitido, rota el CSRF y no amplía actividad ni expiración.
6. Actividad real, renovación y mutaciones usan CSRF. Solo después de validar CSRF se actualiza `last_activity_at`; los `GET` nunca prolongan la sesión.
7. Logout, expiración o inactividad revocan la sesión. Una renovación de una hora exige que la identidad Firebase continúe en memoria.

## Persistencia

PostgreSQL contiene:

- `roles`: clave, nombre, descripción, permisos JSON y marcas de tiempo.
- `users`: correo normalizado, nombre, Firebase UID opcional, rol, estado y marcas de tiempo.
- `auth_sessions`: usuario, hash de secreto, hash CSRF, expiración, última actividad y revocación.

Las migraciones crean `pgcrypto`, tablas, índices y roles protegidos `ADMIN` y `USER`. Cambios que podrían retirar el último administrador activo usan una transacción y bloqueo advisory PostgreSQL.

## Permisos y autorización

- `agent:read`
- `emails:manage`
- `products:read`
- `users:read`
- `users:write`
- `roles:read`
- `roles:write`

`USER` tiene `agent:read`. `ADMIN` tiene todos los permisos. Los CRUD de usuarios y roles exigen el rol protegido `ADMIN` y el permiso específico; un rol personalizado no puede autoelevarse aunque incluya permisos administrativos.

## API

Rutas públicas:

- `GET /api/v1/health`
- `POST /api/v1/auth/session`

Rutas de sesión:

- `POST /api/v1/auth/session/bootstrap`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/activity`
- `POST /api/v1/auth/session/refresh`
- `POST /api/v1/auth/logout`

Rutas administrativas:

- `GET|POST /api/v1/admin/users`
- `GET|PATCH|DELETE /api/v1/admin/users/{userId}`
- `GET|POST /api/v1/admin/roles`
- `GET|PATCH|DELETE /api/v1/admin/roles/{roleId}`

OpenAPI 3.0.3 define respuestas predecibles 401/403/429 y no expone secretos.

## Frontend

- Angular standalone, `OnPush`, signals, `inject()` y rutas lazy.
- Tailwind compilado y Bootstrap Icons locales; no se usa CDN.
- El bundle contiene una plantilla de runtime. El entrypoint de Nginx exige variables públicas de ambiente, renderiza la configuración y falla antes de servir contenido si recibe placeholders o valores incompletos.
- `AuthService` encapsula Firebase Email Link con persistencia en memoria.
- El interceptor añade `withCredentials`, correlación y CSRF solo al origen API permitido.
- Guards mejoran navegación; backend conserva la autoridad.
- El shell muestra Agente IA para usuarios autorizados y controles administrativos solo a `ADMIN`.

## Operación y observabilidad

- Firebase Admin usa credenciales por defecto de Cloud Run; no se usan JSON de claves en el repositorio.
- Firebase y PostgreSQL usan SDK/driver oficial y consultas parametrizadas.
- Logs estructurados incluyen correlación y estado sin tokens, cookies, correos ni prompts.
- El rate limit de autenticación es acotado por instancia; producción debe complementarlo con una política distribuida de gateway o Cloud Armor.
- Nginx genera una CSP con el origen API exacto y hosts Firebase HTTPS allowlisted; source maps y plantillas runtime no son públicos.
