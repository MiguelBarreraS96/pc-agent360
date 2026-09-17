# Implementation Plan: Consulta Cliente 360

## Overview

Implementación del patrón BFF para la consulta consolidada de cliente. El backend (Node.js + Express + TypeScript) expone `POST /seguros/api/v1/cliente360/consulta`, orquestando token OAuth2 en caché, circuit breaker, consulta GraphQL a Conecta y enmascaramiento de PII. El frontend (Angular 20 standalone, OnPush) presenta un formulario reactivo y un área de resultados lado a lado.

Las tareas se ordenan de forma incremental: primero los cimientos (tipos, configuración, schema, enmascaramiento), luego los servicios (token, GraphQL, breaker), luego la orquestación y el controller/router, y finalmente el cableado en `app.ts`. El frontend avanza en paralelo (modelos → servicio → componente → rutas → wiring). Cada tarea construye sobre las anteriores y termina integrada; no queda código huérfano.

Las pruebas basadas en propiedades (PBT con `fast-check`) cubren las 6 propiedades de correctitud definidas en el diseño. Las sub-tareas de prueba marcadas con `*` son opcionales.

## Tasks

- [ ] 1. Configurar dependencias y variables de entorno del backend
  - [x] 1.1 Añadir dependencias del backend (pin exacto, desde JFrog)
    - Agregar a `backend/package.json`: `zod` (3.24.1) como dependencia; `jest` (29.7.0), `@types/jest`, `ts-jest`, `supertest` (7.0.0), `@types/supertest` y `fast-check` (3.23.1) como devDependencies, todas con versión exacta (sin `^`, `~`, `*`)
    - Verificar que cada paquete existe en el registro oficial antes de fijarlo (evitar typosquatting)
    - Añadir script `test` a `backend/package.json` y crear `backend/jest.config.js` con preset `ts-jest`
    - _Requirements: 3, 9_

  - [x] 1.2 Declarar las variables de entorno de Conecta en `.env.example`
    - Añadir a `backend/.env.example` placeholders no reales para: `CONECTA_TOKEN_URL`, `CONECTA_GRAPHQL_URL`, `CONECTA_CLIENT_ID`, `CONECTA_CLIENT_SECRET`, `CONECTA_SCOPE`, `CONECTA_X_USER_KEY`, `CONECTA_TOKEN_TIMEOUT_MS`, `CONECTA_GRAPHQL_TIMEOUT_MS`
    - Cada variable con marcador de posición no vacío que no corresponda a credencial real
    - _Requirements: 9.4_

- [ ] 2. Definir tipos externos y contrato de datos del backend
  - [x] 2.1 Crear tipos externos de Conecta en `cliente360/conecta-types.ts`
    - Definir `TokenRequest`, `TokenResponse`, `GraphQLRequest`, `GraphQLResponse<T>`, `ConectaClienteData` y `ConsultaInput` con tipado estricto y `readonly` según el diseño
    - _Requirements: 4.1, 5.1, 5.3, 5.5_

  - [x] 2.2 Crear el DTO de respuesta enmascarado en `cliente360/cliente360-dto.ts`
    - Definir `CelularDTO`, `ClienteResponseDTO` (allowlist estricta) y el tipo discriminado `ConsultaApiResponse` (`{found:true, cliente}` | `{found:false}`)
    - _Requirements: 6.4, 2.4_

- [x] 3. Extender la configuración con fail-fast de credenciales
  - [x] 3.1 Añadir `ConectaConfig` a `config.ts` con validación fail-fast
    - Extender `AppConfig` con `conecta: ConectaConfig`; implementar `parseRequiredSecret(name, raw)` (aplica `trim()`, lanza `Error` nombrando la variable sin valor si está vacía) y `parseHttpsUrl` (exige protocolo `https:`)
    - Aplicar defaults: scope `SrcServerCognitoConecta/ConectaApiScope`, `tokenTimeoutMs` 5000, `graphqlTimeoutMs` 15000, `tokenRefreshMarginMs` 60000, `breakerFailureThreshold` 5, `breakerRecoveryMs` 30000
    - Leer secretos solo de `process.env`; abortar el arranque al importar si falta un secreto requerido; nunca registrar el valor
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [ ]* 3.2 Escribir pruebas de fail-fast de configuración
    - Verificar que el arranque aborta y nombra cada variable faltante o vacía (tras trim) sin exponer valores; verificar `.env.example` contiene placeholders
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 4. Implementar validación de entrada (Zod schema)
  - [x] 4.1 Crear `cliente360/cliente360-schema.ts` con Zod `.strict()`
    - Definir `consultaSchema = z.object({ tipoDocumento: z.literal("CC"), numeroDocumento: z.number().int().positive().max(9_999_999_999) }).strict()`
    - Exportar helper de validación con `safeParse` que produzca `code = "VALIDATION_ERROR"` y `field` del campo/clave inválida
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

- [x] 5. Implementar enmascaramiento de PII y allowlist
  - [x] 5.1 Crear `cliente360/pii-masking.ts`
    - Implementar `maskLastFour(value)` (revela solo últimos 4 dígitos/caracteres significativos, resto con carácter de máscara fijo; `<4` significativos / vacío / nulo → totalmente enmascarado)
    - Implementar `toClienteResponseDTO(data)` que construye el DTO allowlist estricto desde `ConectaClienteData`, enmascarando `numeroCelular` y descartando campos no incluidos
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.2 Escribir property test de enmascaramiento de PII
    - **Property 4: Invariante de enmascaramiento de PII**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - fast-check, ≥100 iteraciones; genera cadenas/números arbitrarios y verifica que el sufijo revelado es exacto y no se expone ningún carácter fuera del sufijo

- [x] 6. Implementar el servicio de token OAuth2 con caché
  - [x] 6.1 Crear `cliente360/token-service.ts`
    - Implementar `getToken(correlationId)` con caché en memoria: reusa mientras `expiresAtMs - now > tokenRefreshMarginMs`, refresca en caso contrario
    - `POST` a `tokenUrl` con `Content-Type: application/json`, cuerpo `client_credentials`, `AbortController` a 5s, header `X-Correlation-ID`
    - En error/timeout: lanzar `AUTH_UPSTREAM_FAILED` conservando la caché vigente; nunca registrar token/`client_id`/`client_secret`
    - Implementar `invalidate()` que limpia la caché
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.8, 7.1, 8.3_

  - [ ]* 6.2 Escribir property test de reutilización/refresco de token
    - **Property 3: Reutilización y refresco del token en el margen de 60s**
    - **Validates: Requirements 4.3, 4.4**
    - fast-check, ≥100 iteraciones; genera offsets de expiración y verifica refresco ⇔ `r ≤ 60_000 ms` (mockear `fetch` global)

  - [ ]* 6.3 Escribir pruebas unitarias del token service
    - Reuso de caché vigente, refresco al expirar, `invalidate()` ante 401, timeout 5s (AbortController), no registra secretos
    - _Requirements: 4.1, 4.5, 4.6, 5.8, 7.1_

- [x] 7. Implementar el circuit breaker
  - [x] 7.1 Crear `cliente360/circuit-breaker.ts`
    - Máquina de estados closed/open/half-open: umbral 5 fallos consecutivos → open; recuperación 30s → half-open; prueba exitosa → closed; prueba fallida → open otros 30s
    - En estado open, rechazar de inmediato con `CIRCUIT_OPEN` sin invocar el servicio
    - _Requirements: 7.4, 7.5_

  - [ ]* 7.2 Escribir pruebas unitarias del circuit breaker
    - Transición Closed→Open a los 5 fallos; Open→HalfOpen tras 30s (fake timers); HalfOpen→Closed/Open
    - _Requirements: 7.4, 7.5_

- [x] 8. Implementar el cliente GraphQL
  - [x] 8.1 Crear `cliente360/graphql-client.ts`
    - `consultarCliente(input, correlationId)`: `POST` a `graphqlUrl` con headers `Content-Type: application/json`, `Authorization: Bearer <token>`, `x-user-key`, `X-Correlation-ID`
    - Cuerpo con la consulta GraphQL exacta del diseño; `numeroDocumento` serializado como valor numérico; `AbortController` a 15s → `UPSTREAM_TIMEOUT`
    - Cuerpo con `errors` GraphQL → `UPSTREAM_ERROR`; `x-user-key` ausente → `CONFIG_MISSING` sin enviar
    - Ante `401`: `tokenService.invalidate()` y reintento único con token nuevo; segundo 401 → `AUTH_UPSTREAM_FAILED` sin más reintentos
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 7.2, 7.3, 8.3_

  - [ ]* 8.2 Escribir property test de encabezados y correlation-id
    - **Property 6: Invariante de encabezados y propagación de Correlation-ID en llamadas salientes**
    - **Validates: Requirements 5.1, 8.3**
    - fast-check, ≥100 iteraciones; genera correlation-IDs y verifica que las llamadas salientes a token y GraphQL incluyen `X-Correlation-ID = c` y que GraphQL incluye `Content-Type`, `Authorization: Bearer` y `x-user-key`

  - [ ]* 8.3 Escribir pruebas unitarias del cliente GraphQL
    - Headers correctos, `numeroDocumento` numérico, reintento único ante 401 y corte tras segundo 401, timeout 15s → error, manejo de `errors` GraphQL
    - _Requirements: 5.1, 5.3, 5.6, 5.7, 5.8, 5.9, 7.2, 7.3_

- [x] 9. Implementar la orquestación del servicio
  - [x] 9.1 Crear `cliente360/cliente360-service.ts`
    - `consultarCliente(input, correlationId)`: obtener token → ejecutar GraphQL vía circuit breaker → si hay cliente, enmascarar PII y construir DTO allowlist (`found:true`); si no hay cliente, `found:false`
    - Mapear errores controlados a códigos internos; emitir log estructurado (correlationId, ISO-8601, nivel, resultado) sin PII/secretos/tokens
    - _Requirements: 3.2, 3.3, 6.4, 6.5, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 9.2 Escribir property test de allowlist y redacción de secretos/PII
    - **Property 5: Allowlist de salida y redacción de secretos/PII**
    - **Validates: Requirements 3.3, 6.4, 6.5, 8.6, 9.5**
    - fast-check, ≥100 iteraciones; genera objetos upstream con claves extra + errores y verifica que las claves de la respuesta ⊆ DTO y que ni respuesta ni logs contienen token/`client_secret`/`client_id`/`x-user-key`/PII sin enmascarar

- [x] 10. Implementar el controller y el router del endpoint
  - [x] 10.1 Crear `cliente360/cliente360-controller.ts`
    - Validar el cuerpo con `consultaSchema.safeParse`; en fallo → `400` con `{code:"VALIDATION_ERROR", field}` sin invocar servicios externos; en éxito → delegar en `cliente360Service`
    - Responder `200 {found:true, cliente}`, `200 {found:false}`, o delegar errores al `errorHandler` existente (shape `{correlationId, error:{code, message}}`) mapeando 400/502/503/504
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 2.4_

  - [x] 10.2 Crear `cliente360/cliente360-router.ts`
    - Definir `POST /seguros/api/v1/cliente360/consulta` enlazado al controller
    - _Requirements: 3.1_

  - [ ]* 10.3 Escribir property test de validación de backend sin efectos externos
    - **Property 2: Validación de la solicitud en el backend sin efectos externos**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 5.4**
    - fast-check, ≥100 iteraciones; genera cuerpos arbitrarios y verifica que alcanza la orquestación ⇔ entrada válida; en otro caso `400` sin invocar mocks de token/GraphQL

- [x] 11. Cablear el router en la aplicación Express
  - [x] 11.1 Montar el router cliente360 en `app.ts`
    - Registrar el router en `createApp`; asegurar `express.json` para el cuerpo y añadir `POST` a los métodos permitidos de la config CORS existente
    - _Requirements: 3.1, 3.2_

  - [ ]* 11.2 Escribir pruebas de endpoint con Supertest
    - Ruta versionada existe; `200 found:true`, `200 found:false`, `400`, `502/503/504` con shape de error correcto (mockear servicios externos)
    - _Requirements: 3.1, 3.8, 3.9, 2.4_

- [x] 12. Checkpoint del backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Preparar el frontend: HttpClient, entorno y modelos
  - [x] 13.1 Añadir `provideHttpClient()` a `app.config.ts`
    - Registrar `provideHttpClient()` en `providers` (requerido para `HttpClient`)
    - _Requirements: 1.8, 1.9_

  - [x] 13.2 Crear `environments/environment.ts` con `apiBaseUrl`
    - Definir `apiBaseUrl` apuntando al backend propio
    - _Requirements: 1.8, 1.9_

  - [x] 13.3 Crear `features/consulta360/consulta360-models.ts`
    - Definir `ConsultaRequest`, `ViewState`, `ConsultaResult`, `ConsultaApiResponse` y `ClienteResponseDTO` (espejo del contrato del backend)
    - _Requirements: 2.2, 2.3, 2.4_

- [x] 14. Implementar el servicio HTTP del frontend
  - [x] 14.1 Crear `features/consulta360/consulta-cliente.service.ts`
    - `@Injectable({providedIn:'root'})` con `HttpClient` (`inject()`); `consultar(request)` hace `POST` a `${apiBaseUrl}/seguros/api/v1/cliente360/consulta` con `timeout(15000)` y `map(toResult)`
    - Solo llama al backend propio; no usa `localStorage`/`sessionStorage`
    - _Requirements: 1.8, 1.9, 2.6, 2.8_

  - [ ]* 14.2 Escribir pruebas unitarias del servicio
    - Verifica llamada única al backend propio, timeout 15s → resultado `error`, y que no escribe en `localStorage`/`sessionStorage`
    - _Requirements: 1.8, 2.6, 2.8_

- [x] 15. Implementar el componente Consulta360
  - [x] 15.1 Crear `features/consulta360/consulta360.ts` (+ `.html`, `.scss`)
    - Standalone, `OnPush`; formulario reactivo con `tipoDocumento` (`<select>` única opción `CC` por defecto) y `numeroDocumento` (`<input>` texto, `Validators.pattern(/^[0-9]{1,15}$/)`)
    - Botón "Enviar" con `[disabled]="form.invalid || state === 'loading'"`; layout lado a lado (form izquierda, resultados derecha) por CSS
    - Estados de vista: `idle`, `loading` (indicador continuo), `success` (render + `"No disponible"` por campo ausente), `noData` (mensaje exacto `"No existe información de este cliente"`), `error` (mensaje genérico); mostrar mensajes de validación de dígitos y longitud
    - Invocar el servicio al enviar y mapear el resultado al estado de vista
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 15.2 Escribir property test de validación del formulario
    - **Property 1: Validación de documento en el frontend**
    - **Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.7**
    - fast-check, ≥100 iteraciones; genera cadenas arbitrarias y verifica que el formulario es válido y el botón habilitado ⇔ la cadena coincide con `^[0-9]{1,15}$`

  - [ ]* 15.3 Escribir pruebas unitarias del componente
    - Select `CC` por defecto, layout lado a lado, botón habilitado/deshabilitado según validez, estados `loading`/`success`/`noData`/`error` y mensaje exacto de sin datos
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

- [x] 16. Cablear la ruta lazy del frontend
  - [x] 16.1 Añadir la ruta lazy `consulta360` en `app.routes.ts`
    - `{ path: 'consulta360', loadComponent: () => import('./features/consulta360/consulta360').then(m => m.Consulta360Component) }`
    - _Requirements: 1.1, 2.1_

- [x] 17. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las sub-tareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido; las tareas de implementación no son opcionales.
- Cada tarea referencia requisitos específicos para trazabilidad.
- Los checkpoints aseguran validación incremental.
- Las pruebas de propiedad (fast-check, ≥100 iteraciones) validan las 6 propiedades de correctitud del diseño; las pruebas unitarias cubren ejemplos y casos de borde.
- Todas las dependencias con versión exacta desde JFrog; nunca ejecutar código sugerido sin revisión.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "13.1", "13.2", "13.3"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "14.1"] },
    { "id": 2, "tasks": ["3.2", "5.2", "6.1", "7.1", "14.2", "15.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "7.2", "8.1", "15.2", "15.3", "16.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1", "10.2"] },
    { "id": 6, "tasks": ["10.3", "11.1"] },
    { "id": 7, "tasks": ["11.2"] }
  ]
}
```
