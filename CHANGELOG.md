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
- Se agregó un mini agente por producto que prueba el RAG y usa Gemini solo con evidencia recuperada y redactada.
- Se restauró la ruta de colección de Discovery Engine requerida antes de iniciar la creación del DataStore.
- Se consolidó Consulta Cliente 360 con la configuración runtime del frontend para apuntar al backend autorizado sin duplicar URLs por ambiente.
- Se integró la vista protegida Consulta Cliente 360 en la navegación de escritorio y móvil para usuarios con permiso `agent:read`.
- Se crearon los requisitos, diseño técnico y plan de implementación de Consulta Cliente 360 con patrón BFF, OAuth2, GraphQL, circuit breaker, enmascaramiento de PII y pruebas de correctitud.
- Se declararon variables de entorno de Conecta con placeholders no secretos, timeouts documentados y validación de endpoints HTTPS institucionales.
- Se agregaron las dependencias de Cliente 360 y pruebas con versiones exactas, junto con el script Jest y su configuración.
- Se crearon los tipos de Conecta, el DTO allowlist de respuesta enmascarada, los modelos Angular y el esquema Zod estricto para la consulta por documento.
- Se creó el servicio frontend de Consulta Cliente 360 con timeout de 15 segundos, estados tipados y llamadas únicamente al BFF propio.
- Se crearon los clientes GraphQL y OAuth2 de Conecta, la caché de token, el circuit breaker, el servicio de consulta y el controlador con errores controlados.
- Se crearon el componente, plantilla y estilos responsivos de Consulta Cliente 360 con formulario reactivo, accesibilidad y visualización de resultados sin PII completa.
- Se creó la ruta versionada `POST /seguros/api/v1/cliente360/consulta` y se protegió con autenticación de sesión, permiso `agent:read` y CSRF.
- Se agregó configuración no sensible de Cloud Run para Cliente 360 y referencias de Secret Manager para sus credenciales de integración.
- Se creó el spec `fix-consulta-cliente-360-graphql` para documentar la causa raíz y el plan de corrección del contrato GraphQL de Conecta.

### Cambiado
- Se actualizó el script de desarrollo para cargar `.env` automáticamente mediante `tsx watch --env-file=.env`.
- Se actualizaron los requisitos de Consulta Cliente 360 para incorporar un botón de envío, la disposición lado a lado de los resultados y el mensaje específico cuando no hay información.
- Se consolidaron las configuraciones de frontend y backend para obtener valores públicos de Firebase en runtime y mantener dependencias exactas.
- Se configuró la imagen frontend para renderizar su configuración y CSP desde variables de ambiente, rechazando placeholders al iniciar.
- Se agregaron preflights de despliegue para validar variables públicas de frontend y referencias de Secret Manager antes de invocar Cloud Run.
- Se crearon los proyectos iniciales de backend Node.js con Express y frontend Angular, junto con sus configuraciones de compilación, contrato OpenAPI de disponibilidad y documentación de arranque.

### Corregido
- Se corrigió el `502 UPSTREAM_ERROR` de Consulta Cliente 360 alineando la consulta GraphQL con el contrato real de Conecta, incluidos el argumento `ClienteInput!`, el fragmento `Cliente360NaturalType` y los tipos de celular y aptitudes.
- Se corrigió el bloqueo de Consulta Cliente 360 desde el frontend desplegado al permitir el backend Cloud Run en la CSP y los orígenes HTTPS autorizados en CORS.
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
