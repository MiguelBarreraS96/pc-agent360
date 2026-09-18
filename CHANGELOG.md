# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto adhiere a [Versionamiento Semántico](https://semver.org/lang/es/).

## [No publicado]

### Agregado
- Se implementó autenticación con Firebase Email Link, sesiones opacas de una hora, cierre por inactividad y validación de tokens en el backend.
- Se agregaron CRUD de usuarios autorizados y roles con permisos, migración PostgreSQL, contrato OpenAPI y colección Postman.
- Se creó la interfaz Angular con Tailwind, Bootstrap Icons, navegación por permisos, Agente IA, whitelist de correos y Productos administrativo.
- Se conectó temporalmente el chat Angular a Gemini mediante una ruta autenticada exclusiva de desarrollo para verificar la integración local sin RAG.
- Se agregaron eventos estructurados para diagnosticar el aprovisionamiento RAG de Vertex AI Search con correlación y detalle externo saneado.
- Se envió el nombre normalizado del producto como `displayName` al crear el DataStore y el Engine de Vertex AI Search.
- Se persistieron proyecto, ubicación e IDs deterministas de DataStore y Engine para el ciclo de aprovisionamiento RAG.
- Se configuró el flujo RAG para usar la ubicación regional `us`, verificar recursos existentes y crear el Engine solo tras confirmar el DataStore.
- Se restauró la ruta de colección de Discovery Engine requerida antes de iniciar la creación del DataStore.

### Cambiado
- Se actualizaron las configuraciones de frontend y backend para obtener valores públicos de Firebase en runtime y dependencias exactas pendientes de resolución por JFrog.
- Se configuró la imagen frontend para renderizar su configuración y CSP desde variables de ambiente, rechazando placeholders al iniciar.
- Se agregaron preflights de despliegue para validar variables públicas de frontend y referencias de Secret Manager de backend antes de invocar Cloud Run.

### Corregido
- Se sustituyó la restauración mutante por GET por un bootstrap POST con `Origin` exacto y CSRF efímero, sin extender la expiración máxima ni la inactividad.
- Se corrigió la validación de códigos HTTP del manejador de errores para permitir la compilación TypeScript del backend en Cloud Build.
- Se habilitó la edición controlada de permisos del rol protegido ADMIN para asignar el acceso de gestión de productos desde la interfaz administrativa.
- Se corrigieron las inferencias de permisos y la resolución de IP para conservar la compilación estricta del backend.
- Se corrigió la autorización para que el rol protegido ADMIN satisfaga todos los permisos requeridos, incluido `products:write`.

### Seguridad
- Se evitó la persistencia de tokens Firebase, cookies y CSRF en almacenamiento local, y se aplicaron CSRF, CORS estricto, cookies HttpOnly y autorización de backend.
- Se restringieron los CRUD administrativos al rol protegido `ADMIN`, se protegió el último administrador activo con transacciones y se evitaron heartbeats GET que prolongaban sesiones.
- Se agregó rate limiting por IP para autenticación con respuestas `429` y `Retry-After`; la política distribuida queda a cargo del gateway o Cloud Armor.
- Se limitó la prueba temporal de Gemini a entornos no productivos con sesión, permiso `agent:read`, CSRF, respuesta sin caché y redacción de identificadores comunes.
- Se evitó la exposición de detalles internos durante un fallo de inicio del frontend.
- Se documentó la validación obligatoria de lockfiles y permisos antes del despliegue desde fuente en Cloud Run.
