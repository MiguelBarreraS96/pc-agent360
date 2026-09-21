# Changelog
- Se implementó el agente de ventas con LangGraph (`/api/v1/agent`): consulta Cliente 360 por cédula, sugiere productos del catálogo, arma un resumen y un guion de venta según edad y perfil, y atiende preguntas y acciones rápidas durante la llamada. Todo dato del producto proviene del clausulado: cada hecho se acepta solo si su cita literal existe en la evidencia recuperada y las cifras del guion deben figurar en ella.

Todos los cambios notables de este servicio se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto adhiere a [Versionamiento Semántico](https://semver.org/lang/es/).

## [No publicado]

### Agregado
- Se agregaron autenticación Firebase validada por backend, sesiones opacas, protección CSRF y autorización por permisos.
- Se agregaron persistencia PostgreSQL, migración de usuarios, roles y sesiones, junto con CRUD administrativo y contratos OpenAPI/Postman.
- Se agregó preflight de despliegue que exige una referencia de Secret Manager para PostgreSQL y configuración explícita de Cloud Run.
- Se agregó una ruta temporal de desarrollo para comprobar desde el frontend la conectividad directa con Gemini mediante Vertex AI, sin RAG ni instrucción de sistema.
- Se agregaron eventos estructurados para el aprovisionamiento RAG de Vertex AI Search, con correlación, etapa, operación y diagnóstico externo saneado.
- Se envió el nombre normalizado del producto como `displayName` al crear el DataStore y el Engine de Vertex AI Search.
- Se persistieron proyecto, ubicación e IDs deterministas de DataStore y Engine para el ciclo de aprovisionamiento RAG.
- Se configuró el flujo RAG para usar la ubicación regional `us`, verificar recursos existentes y crear el Engine solo tras confirmar el DataStore.
- Se agregaron endpoints de probe RAG y mini agente Gemini por producto, con evidencia recuperada, validación estricta y redacción de datos sensibles.
- Se restauró la ruta de colección de Discovery Engine requerida antes de iniciar la creación del DataStore.

### Corregido
- Se corrigió la clasificación de JSON malformado y la validación de permisos de roles durante la autenticación y la administración.
- Se corrigió la restauración de sesiones para rotar CSRF sin extender la expiración absoluta ni el límite de inactividad.
- Se aclaró que el bootstrap de sesión usa validación estricta de `Origin` como excepción al CSRF y no registra actividad.
- Se corrigió la autorización para que el rol protegido ADMIN satisfaga todos los permisos requeridos, incluido `products:write`.

### Seguridad
- Se protegieron las mutaciones con CSRF y se evitaron secretos, tokens y datos personales en respuestas y registros.
- Se reforzó la administración para aceptar solo el rol protegido `ADMIN` y contar exclusivamente administradores protegidos al preservar el último administrador activo.
- Se agregó rate limiting por IP para endpoints de autenticación con respuesta `429` y `Retry-After`.
- Se limitó la ruta temporal de Gemini a entornos no productivos, sesión autenticada, permiso `agent:read`, CSRF, respuestas sin caché y redacción de identificadores comunes.
