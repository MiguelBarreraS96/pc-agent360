# Requisitos — Autenticación Firebase y control de accesos

## Objetivo
Implementar un acceso seguro para Agente 360 que autentique correos corporativos permitidos con Firebase Email Link, valide la identidad en el backend y aplique permisos por rol.

## Alcance funcional

1. El usuario solicita acceso con su correo corporativo desde la pantalla de inicio de sesión.
2. Firebase envía un enlace de acceso al correo indicado. La dirección debe verificarse al completar el enlace.
3. El backend recibe un Firebase ID token por HTTPS, verifica su integridad y únicamente crea una sesión si existe un usuario activo en la lista autorizada.
4. Las sesiones duran como máximo una hora y terminan tras el periodo configurable de inactividad, con 15 minutos como valor inicial seguro.
5. Un usuario `USER` puede acceder solamente a Agente IA.
6. Un usuario `ADMIN` puede acceder a Agente IA, Correos conectados, Productos y gestión de accesos.
7. Los administradores pueden crear, consultar, actualizar, activar/desactivar y eliminar usuarios autorizados.
8. Los administradores pueden crear, consultar, actualizar y eliminar roles no protegidos, asignando únicamente permisos permitidos por la aplicación.
9. La administración de correos conectados representa la whitelist de usuarios autorizados.
10. Productos permanece como una vista administrativa sin CRUD de backend en esta iteración.

## Requisitos de seguridad

- No se almacenan Firebase ID tokens, refresh tokens ni sesiones en `localStorage`.
- La sesión de aplicación usa una cookie `HttpOnly`, `Secure` en producción y `SameSite` configurable.
- Las solicitudes que modifican estado requieren un token CSRF emitido por el backend.
- El backend valida el Firebase ID token y resuelve el usuario, rol y permisos en PostgreSQL; el frontend nunca determina autorización.
- Los correos se normalizan, se validan y se devuelven solo en DTOs explícitos.
- Las entradas de usuarios, roles, sesiones y parámetros se validan con esquemas estrictos.
- Los errores hacia el cliente son genéricos y los logs no incluyen tokens, cookies ni datos personales.
- CORS solo permite orígenes explícitos y usa credenciales únicamente para dichos orígenes.

## Configuración pendiente

La implementación debe compilar con archivos de configuración de ejemplo, pero requiere antes del despliegue:

- Proyecto Firebase y la configuración pública de la aplicación web.
- Dominio HTTPS de frontend y URL HTTPS del backend por ambiente.
- Cuenta de servicio de Cloud Run con permisos mínimos para validar Firebase ID tokens.
- URL de PostgreSQL y contraseña entregadas mediante Secret Manager o variables de entorno seguras.
- Correo del administrador inicial configurado fuera del repositorio mediante `BOOTSTRAP_ADMIN_EMAIL`.

## Criterios de aceptación

- Un usuario sin whitelist o inactivo no obtiene una sesión, aunque Firebase lo autentique.
- Un usuario `USER` no puede acceder ni por URL ni por API a funciones administrativas.
- Un `ADMIN` puede gestionar whitelist, usuarios y roles permitidos.
- La sesión se rechaza al expirar una hora, al superar inactividad o tras logout.
- Cada operación protegida usa una sesión válida y las mutaciones requieren CSRF.
- El menú refleja los permisos devueltos por el backend.
- La aplicación no compila ni despliega configuraciones con secretos embebidos.
