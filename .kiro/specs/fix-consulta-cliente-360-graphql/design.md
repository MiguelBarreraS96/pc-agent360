# Design Document

## Overview

Corrección localizada del defecto que produce `502 Bad Gateway` en la Consulta Cliente 360. El diagnóstico (verificado contra el endpoint real de Conecta) es un desajuste de contrato GraphQL en tres dimensiones: firma de la consulta, tipo union de `cliente360`, y tipos de datos de `numeroCelular` y `apto*`.

El diseño mantiene intacta la arquitectura BFF: autenticación OAuth2 con caché, circuit breaker, manejo de errores controlados, validación Zod de entrada y el contrato REST expuesto al frontend. Los cambios se concentran en la consulta GraphQL, los tipos externos, la transformación de PII y la visualización de los campos de aptitud.

## Diagnóstico (causa raíz)

Secuencia observada en los logs de Cloud Run:

1. `server_started` → OK.
2. Preflight CORS `204` → OK (CSP/CORS ya resueltos en cambios previos).
3. `conecta_token_refreshed` → el token OAuth2 se obtiene correctamente (credenciales y endpoint de token válidos).
4. `cliente360_consulta_fallida` con `code=UPSTREAM_ERROR` → la llamada GraphQL falla.
5. `http_request_completed` con `502`.

Reproducción directa contra Conecta con la consulta actual del backend devuelve `400` con:

- `Unknown argument 'tipoDocumento' on field 'Query.cliente'`
- `Unknown argument 'numeroDocumento' on field 'Query.cliente'`
- `Field 'cliente' argument 'cliente' of type 'ClienteInput!' is required, but it was not provided`

Reproducción con la consulta correcta (argumento anidado + inline fragment) devuelve `200` con datos, revelando además que `numeroCelular` es numérico y `apto*` son cadenas `"Si"`/`"No"`.

## Componentes y cambios

### 1. `backend/src/cliente360/graphql-client.ts` — Consulta GraphQL

**Cambio:** reemplazar la constante `CONSULTA_CLIENTE_QUERY` por la firma correcta.

Query objetivo (equivalente a la validada en Postman):

```graphql
query Cliente($tipoDocumento: String!, $numeroDocumento: BigInt!) {
  cliente(cliente: { tipoDocumento: $tipoDocumento, numeroDocumento: $numeroDocumento }) {
    demografica { edad }
    contacto {
      mejorCelular { numeroCelular fuente }
      celulares { numeroCelular fuente }
    }
    cliente360 {
      ... on Cliente360NaturalType {
        clv
        categoriaIngresos
        antiguedad
        ciudad
        productoRecomendado
        aptoAutos
        aptoHogar
        aptoSalud
        aptoVida
      }
    }
    valorIngresos
  }
}
```

**Sin cambios** en: construcción de variables (`buildRequestBody` sigue enviando `numeroDocumento` numérico), encabezados (`Authorization`, `x-user-key`, `X-Correlation-ID`), timeout con `AbortController`, reintento único ante 401, y traducción de fallas a `UPSTREAM_TIMEOUT`/`UPSTREAM_ERROR`/`CONFIG_MISSING`/`AUTH_UPSTREAM_FAILED`.

Rationale: la variable `numeroDocumento` (máx. 9.999.999.999) está dentro de `Number.MAX_SAFE_INTEGER`, por lo que enviarla como número JSON no pierde precisión, consistente con el diseño original.

### 2. `backend/src/cliente360/conecta-types.ts` — Tipos externos

**Cambios en `ConectaClienteData`:**

- `mejorCelular.numeroCelular`: `string | null` → `number | string | null`.
- `celulares[].numeroCelular`: `string | null` → `number | string | null`.
- `cliente360.aptoAutos`: `boolean | null` → `string | null`.
- `cliente360.aptoHogar`: `boolean | null` → `string | null`.
- `cliente360.aptoSalud`: `boolean | null` → `string | null`.
- `cliente360.aptoVida`: `boolean | null` → `string | null`.

**Sin cambios:** `edad`, `antiguedad`, `valorIngresos` (`number | null`); `fuente`, `clv`, `categoriaIngresos`, `ciudad`, `productoRecomendado` (`string | null`). El tipo aplica `number | string` en `numeroCelular` por robustez: acepta el número real y tolera un futuro string.

### 3. `backend/src/cliente360/pii-masking.ts` — Enmascaramiento

**Cambios:**

- `maskLastFour(value: string | null | undefined)` → `maskLastFour(value: number | string | null | undefined)`.
- Al inicio de la función, normalizar el valor numérico a string: si `typeof value === "number"`, convertirlo con `String(value)` antes del `trim()`. El resto de la lógica (revelar últimos 4, enmascarar resto, casos vacío/corto) permanece igual.
- `toCelularDTO` recibe ahora `numeroCelular: number | string | null`; sigue llamando a `maskLastFour`, que ahora acepta número.

**Cambios en la construcción del DTO (`toClienteResponseDTO`):**

- Los campos `apto*` se copian tal cual (`string | null`), sin coerción a booleano.

**Sin cambios:** el DTO expuesto mantiene `numeroCelular: string` (ya enmascarado). La política de revelar solo 4 dígitos no cambia.

### 4. `backend/src/cliente360/cliente360-dto.ts` — Contrato de respuesta

**Cambios en `ClienteResponseDTO.cliente360`:**

- `aptoAutos`, `aptoHogar`, `aptoSalud`, `aptoVida`: `boolean | null` → `string | null`.

**Sin cambios:** `CelularDTO.numeroCelular` sigue siendo `string` (enmascarado). El resto del contrato no cambia. La forma `{ found: true, cliente } | { found: false }` se mantiene.

### 5. Frontend — Modelos y vista

**`frontend/src/app/features/consulta360/consulta360-models.ts`:**

- `ClienteResponseDTO.cliente360.aptoAutos/aptoHogar/aptoSalud/aptoVida`: `boolean | null` → `string | null` (espejo del backend).

**`frontend/src/app/features/consulta360/consulta360.html`:**

- Reemplazar la expresión booleana `data.cliente360.aptoAutos === null ? noDisponible : (data.cliente360.aptoAutos ? 'Sí' : 'No')` por el patrón de dato opcional usado en los demás campos: `data.cliente360.aptoAutos ?? noDisponible` (y equivalentes para hogar/salud/vida).
- Rationale: al ser ahora `string`, el valor `"Si"`/`"No"` de Conecta se muestra directamente; la evaluación booleana anterior renderizaba `"Sí"` para cualquier string no vacío (incluido `"No"`), lo cual era el defecto.

**Sin cambios:** el resto de la plantilla (demográficos, contacto, celulares, ingresos), los estados de vista, el formulario y el servicio.

## Flujo corregido (end-to-end)

```
Consulta360_Frontend
  → POST /seguros/api/v1/cliente360/consulta { tipoDocumento: "CC", numeroDocumento }
    → Cliente360_API (controller: valida con Zod)
      → cliente360Service (circuit breaker)
        → tokenService.getToken()  [OK, ya funcionaba]
        → graphqlClient.consultarCliente()
            query: cliente(cliente: { ... }) + ... on Cliente360NaturalType
            → Conecta_GraphQL_Endpoint  → 200 data.cliente
        → toClienteResponseDTO()  [enmascara numeroCelular numérico, copia apto* como string]
      → { found: true, cliente }  → 200
  → render de resultados (apto* mostrado como string)
```

## Manejo de errores

Sin cambios respecto al diseño existente. La corrección elimina la causa del `UPSTREAM_ERROR` para consultas válidas, pero el mapeo de errores controlados se conserva:

- `VALIDATION_ERROR` → 400
- `AUTH_UPSTREAM_FAILED` → 502
- `UPSTREAM_ERROR` → 502 (para fallas GraphQL reales, no por contrato)
- `UPSTREAM_TIMEOUT` → 504
- `CIRCUIT_OPEN` → 503

## Consideraciones de seguridad

- El enmascaramiento del `numeroCelular` numérico se realiza tras convertir a string; se conserva la garantía de revelar solo los últimos 4 dígitos.
- No se registran token, secretos ni PII. Los logs estructurados mantienen solo `correlationId` y campos seguros.
- El contrato allowlist del DTO se conserva: solo se serializan las claves declaradas.

## Estrategia de verificación

1. **Typecheck**: `npm run typecheck` en backend y `npm run typecheck` (o build de desarrollo) en frontend, ambos sin errores.
2. **Prueba directa contra Conecta** (fuera del deploy): reproducir la query corregida con un documento existente y confirmar `200` con datos.
3. **Prueba end-to-end en local**: levantar backend con `.env`, enviar la consulta y confirmar `200 { found: true, cliente }` con `numeroCelular` enmascarado y `apto*` como string.
4. **Verificación de no regresión**: caso `found: false` (documento inexistente) devuelve `200 { found: false }`; entrada inválida devuelve `400 VALIDATION_ERROR`.
5. **Despliegue**: solo con consentimiento explícito del usuario (según steering `deploy-consent`). Verificar en producción con documento real.

## Alcance y no-objetivos

- **No** se modifica la arquitectura BFF, el flujo OAuth2, el circuit breaker ni el contrato REST (salvo el tipo de los `apto*`).
- **No** se aborda el warning secundario de CSP `script-src 'self'` (el `onload` inline que inyecta el build de Angular); es independiente de este defecto y no bloquea la consulta.
- **No** se introducen nuevas dependencias.
