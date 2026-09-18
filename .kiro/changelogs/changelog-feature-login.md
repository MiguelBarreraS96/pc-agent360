# Changelog — feature/login

## [No publicado]

### Agregado
- Se agregó autenticación Firebase Email Link con validación de ID token en Express, sesiones seguras, expiración de una hora e inactividad configurable.
- Se agregaron CRUD de whitelist de usuarios, roles y permisos con persistencia PostgreSQL, migración, OpenAPI y Postman.
- Se agregó interfaz Angular con Tailwind, Bootstrap Icons, navegación condicional por permisos y vistas administrativas.
- Se agregó inyección controlada de configuración pública y CSP del frontend al iniciar el contenedor.
- Se agregaron preflights de despliegue para Cloud Run con configuración pública validada y referencias a Secret Manager.
- Se agregaron eventos estructurados para diagnosticar el aprovisionamiento RAG de Vertex AI Search con correlación y detalle externo saneado.
- Se envió el nombre normalizado del producto como `displayName` al crear el DataStore y el Engine de Vertex AI Search.
- Se persistieron proyecto, ubicación e IDs deterministas de DataStore y Engine para el ciclo de aprovisionamiento RAG.
- Se configuró el flujo RAG para usar la ubicación regional `us`, verificar recursos existentes y crear el Engine solo tras confirmar el DataStore.
- Se agregó un mini agente por producto que prueba el RAG y usa Gemini solo con evidencia recuperada y redactada.
- Se restauró la ruta de colección de Discovery Engine requerida antes de iniciar la creación del DataStore.

### Corregido
- Se corrigió la restauración de sesión para usar bootstrap POST, emitir un CSRF efímero y no extender actividad o duración máxima.
- Se habilitó la edición controlada de permisos del rol protegido ADMIN para asignar el acceso de gestión de productos desde la interfaz administrativa.
- Se corrigieron las inferencias de permisos y la resolución de IP para conservar la compilación estricta del backend.
- Se corrigió la autorización para que el rol protegido ADMIN satisfaga todos los permisos requeridos, incluido `products:write`.

### Seguridad
- Se evitaron tokens en almacenamiento local y se aplicaron cookies HttpOnly, CSRF, CORS de orígenes explícitos y autorización en backend.
- Se restringió la administración al rol protegido `ADMIN`, se serializó la continuidad del último administrador y se eliminó la prolongación de sesión por GET.
- Se agregó rate limiting por IP para autenticación y se documentó el complemento distribuido requerido en gateway o Cloud Armor.
