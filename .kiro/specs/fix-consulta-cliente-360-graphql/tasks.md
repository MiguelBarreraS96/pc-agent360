# Implementation Plan

Corrección del defecto `502 UPSTREAM_ERROR` en Consulta Cliente 360 por desajuste de contrato GraphQL. Cada tarea es incremental y verificable. El despliegue queda fuera de la implementación y requiere consentimiento explícito del usuario.

- [ ] 1. Corregir la consulta GraphQL en el backend
  - Reemplazar `CONSULTA_CLIENTE_QUERY` en `backend/src/cliente360/graphql-client.ts` por la firma con argumento anidado `cliente(cliente: { tipoDocumento: $tipoDocumento, numeroDocumento: $numeroDocumento })`.
  - Envolver la selección de campos de `cliente360` en el inline fragment `... on Cliente360NaturalType { ... }`.
  - Conservar variables `$tipoDocumento: String!`, `$numeroDocumento: BigInt!` y el envío de `numeroDocumento` como número.
  - No modificar encabezados, timeout, reintento 401 ni traducción de errores.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Alinear los tipos externos de Conecta
  - En `backend/src/cliente360/conecta-types.ts`, cambiar `numeroCelular` (en `mejorCelular` y `celulares[]`) a `number | string | null`.
  - Cambiar `aptoAutos`, `aptoHogar`, `aptoSalud`, `aptoVida` a `string | null`.
  - Dejar sin cambios `edad`, `antiguedad`, `valorIngresos`, `fuente`, `clv`, `categoriaIngresos`, `ciudad`, `productoRecomendado`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 3. Corregir el enmascaramiento del número de celular
  - En `backend/src/cliente360/pii-masking.ts`, ampliar la firma de `maskLastFour` a `number | string | null | undefined`.
  - Normalizar el número a string (`String(value)`) antes del `trim()`, conservando el resto de la lógica de enmascaramiento.
  - Ajustar `toCelularDTO` para aceptar `numeroCelular: number | string | null`.
  - En `toClienteResponseDTO`, copiar los campos `apto*` como `string | null` sin coerción a booleano.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4. Actualizar el DTO de respuesta del backend
  - En `backend/src/cliente360/cliente360-dto.ts`, cambiar `aptoAutos/aptoHogar/aptoSalud/aptoVida` de `boolean | null` a `string | null`.
  - Conservar `CelularDTO.numeroCelular` como `string` (enmascarado).
  - _Requirements: 4.1_

- [ ] 5. Alinear el modelo del frontend
  - En `frontend/src/app/features/consulta360/consulta360-models.ts`, cambiar los `apto*` de `boolean | null` a `string | null` (espejo del backend).
  - _Requirements: 4.1_

- [ ] 6. Corregir la visualización de los campos de aptitud
  - En `frontend/src/app/features/consulta360/consulta360.html`, reemplazar la expresión booleana de cada `apto*` por `data.cliente360.aptoX ?? noDisponible`.
  - Verificar que un valor `"No"` se muestre como `"No"` y no como `"Sí"`.
  - _Requirements: 4.2, 4.3, 4.4_

- [ ] 7. Verificar tipos y build sin regresiones
  - Ejecutar `npm run typecheck` en `backend` (sin errores).
  - Ejecutar el build de desarrollo del `frontend` (sin errores).
  - _Requirements: 5.4_

- [ ] 8. Verificar el flujo end-to-end (local + contra Conecta)
  - Reproducir la query corregida directamente contra Conecta con un documento existente y confirmar `200` con datos.
  - Levantar el backend local con `.env` y confirmar `200 { found: true, cliente }` con `numeroCelular` enmascarado y `apto*` como string.
  - Confirmar no regresión: documento inexistente → `200 { found: false }`; entrada inválida → `400 VALIDATION_ERROR`.
  - Confirmar que ni logs ni respuesta exponen el `numeroCelular` completo.
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 9. Actualizar CHANGELOG y preparar commit
  - Registrar en `CHANGELOG.md` (sección `[No publicado]` → `Corregido`) la corrección del contrato GraphQL y los tipos.
  - Dejar los cambios listos para commit (backend + frontend + spec + changelog).
  - _Requirements: (documentación)_

- [ ] 10. Despliegue (requiere consentimiento explícito del usuario)
  - Con confirmación del usuario, desplegar backend `bk-agent360` y frontend `pl-agent360` a Cloud Run.
  - Verificar en producción con un documento real que la consulta responde `200` con datos y PII enmascarada.
  - _Requirements: 5.1, 5.5_

## Grafo de dependencias

- Tareas 1 y 2 son independientes entre sí y habilitan la 3.
- La 3 depende de la 2 (tipos) para tipar correctamente el enmascaramiento.
- La 4 depende de la 2; la 5 refleja la 4; la 6 depende de la 5.
- La 7 depende de 1–6.
- La 8 depende de la 7.
- La 9 depende de la 8.
- La 10 depende de la 9 y del consentimiento del usuario.
