# Changelog — merge/Main-Login

## [No publicado]

### Agregado
- Se integró Consulta Cliente 360 con su BFF de Conecta, vista Angular protegida y acceso desde la navegación autenticada.

### Cambiado
- Se conciliaron las configuraciones de Firebase, RAG, sesiones y Conecta para mantener ambas funcionalidades en el backend y frontend.
- Se extendió el preflight de Cloud Run para validar los endpoints Conecta, múltiples orígenes CORS y las referencias de Secret Manager antes de desplegar.

### Corregido
- Se corrigió la inferencia de salida de Zod para conservar defaults validados en las operaciones RAG.

### Seguridad
- Se protegió la consulta de Cliente 360 con autenticación de sesión, permiso `agent:read`, CSRF, CORS de orígenes explícitos y propagación de correlación.
