# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto adhiere a [Versionamiento Semántico](https://semver.org/lang/es/).

## [No publicado]

### Agregado
- Se crearon los proyectos iniciales de backend Node.js con Express y frontend Angular, junto con sus configuraciones de compilación y documentación de arranque.
- Se agregó el contrato OpenAPI y la colección Postman para el endpoint de disponibilidad del backend.

### Cambiado
- Se adaptaron los Dockerfiles, Nginx y scripts de despliegue para los servicios Cloud Run `pl-agent360` y `bk-agent360` en `us-central1`.

### Corregido
- Se corrigió la validación de códigos HTTP del manejador de errores para permitir la compilación TypeScript del backend en Cloud Build.

### Seguridad
- Se evitó la exposición de detalles internos durante un fallo de inicio del frontend.
- Se documentó la validación obligatoria de lockfiles y permisos antes del despliegue desde fuente en Cloud Run.