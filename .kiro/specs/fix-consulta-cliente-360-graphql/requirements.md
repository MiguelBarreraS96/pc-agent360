# Requirements Document

## Introduction

Esta especificación corrige el defecto que impide completar la **Consulta Cliente 360** en producción. Tras resolver los bloqueos de CSP y CORS, la petición del frontend llega al backend, el backend obtiene correctamente el `OAuth2_Token`, pero la llamada al `Conecta_GraphQL_Endpoint` falla con `UPSTREAM_ERROR` y el backend responde `502 Bad Gateway`.

La causa raíz, verificada empíricamente contra el endpoint real de Conecta, es un **desajuste entre el contrato GraphQL real de Conecta y lo que asume el backend**, en tres puntos:

1. **Firma de la consulta**: el backend envía `cliente(tipoDocumento: ..., numeroDocumento: ...)` con argumentos sueltos, pero el esquema real espera un único argumento `cliente` de tipo `ClienteInput!`, es decir `cliente(cliente: { tipoDocumento: ..., numeroDocumento: ... })`.
2. **Tipo union en `cliente360`**: el campo `cliente360` es un tipo union/interface; sus campos deben seleccionarse mediante un inline fragment `... on Cliente360NaturalType { ... }`.
3. **Tipos de datos reales distintos a los asumidos**: `numeroCelular` llega como valor **numérico** (no string), y `aptoAutos`/`aptoHogar`/`aptoSalud`/`aptoVida` llegan como **cadenas `"Si"`/`"No"`** (no booleanos).

Sin corregir la firma y el fragment, Conecta devuelve errores de validación GraphQL (`400` con `errors`). Sin corregir los tipos, aunque la consulta pase, el enmascaramiento de PII del `numeroCelular` y la visualización de los campos `apto*` producirían resultados incorrectos.

El alcance se limita a alinear el contrato GraphQL y los tipos/transformaciones asociados. No cambia la arquitectura BFF, la autenticación OAuth2, el circuit breaker, ni el contrato REST expuesto al frontend salvo lo estrictamente necesario para representar correctamente los campos `apto*`.

## Glossary

- **Conecta_GraphQL_Endpoint**: Servicio externo GraphQL en `https://api-conecta.segurosbolivar.com/prod/dataops/graphql/cliente`.
- **ClienteInput**: Tipo de entrada GraphQL de Conecta que envuelve `tipoDocumento` y `numeroDocumento` en un único argumento `cliente`.
- **Cliente360NaturalType**: Tipo concreto (miembro del union/interface del campo `cliente360`) cuyos campos se seleccionan mediante inline fragment.
- **GraphQL_Client**: Componente del backend (`backend/src/cliente360/graphql-client.ts`) que ejecuta la consulta.
- **PII_Masking**: Componente del backend (`backend/src/cliente360/pii-masking.ts`) que enmascara el `numeroCelular` y construye el DTO allowlist.
- **ClienteResponseDTO**: Contrato de respuesta del backend expuesto al frontend (`backend/src/cliente360/cliente360-dto.ts`).
- **Consulta360_Frontend**: Vista Angular `consulta360` que presenta los resultados.
- **numeroCelular**: Número de celular del cliente; en la respuesta real de Conecta es un valor numérico.
- **apto\***: Campos `aptoAutos`, `aptoHogar`, `aptoSalud`, `aptoVida`; en la respuesta real de Conecta son cadenas `"Si"` o `"No"` (o ausentes/`null`).

## Evidencia de la respuesta real (documento de prueba `numeroDocumento=26910286`, `tipoDocumento=CC`)

```json
{
  "data": {
    "cliente": {
      "demografica": { "edad": 68 },
      "contacto": {
        "mejorCelular": { "numeroCelular": 3007743753, "fuente": "TERCEROS_SEGUROS_BOLIVAR" },
        "celulares": [
          { "numeroCelular": 3007743753, "fuente": "DATACREDITO" },
          { "numeroCelular": 3007743753, "fuente": "DAVIVIENDA" }
        ]
      },
      "cliente360": {
        "clv": "Bronce",
        "categoriaIngresos": "Ingresos altos",
        "antiguedad": 12,
        "ciudad": "Santa Marta",
        "productoRecomendado": "VIDA_INDIVIDUAL",
        "aptoAutos": "No",
        "aptoHogar": "No",
        "aptoSalud": "No",
        "aptoVida": "Si"
      },
      "valorIngresos": 8718722.0
    }
  }
}
```

Tipos observados: `edad`, `valorIngresos`, `antiguedad` son `number`; `numeroCelular` es `number`; `fuente`, `clv`, `categoriaIngresos`, `ciudad`, `productoRecomendado` son `string`; `aptoAutos/Hogar/Salud/Vida` son `string` (`"Si"`/`"No"`).

## Requirements

### Requirement 1: Consulta GraphQL alineada con el contrato real de Conecta

**User Story:** Como consumidor del `Cliente360_API`, quiero que el backend envíe la consulta GraphQL con la firma que el `Conecta_GraphQL_Endpoint` espera, para que la consulta se resuelva con `200` en lugar de fallar con errores de validación.

#### Acceptance Criteria

1. THE GraphQL_Client SHALL construir la consulta usando un único argumento `cliente` de tipo `ClienteInput!`, con la forma `cliente(cliente: { tipoDocumento: $tipoDocumento, numeroDocumento: $numeroDocumento })`.
2. THE GraphQL_Client SHALL declarar las variables con los tipos `$tipoDocumento: String!` y `$numeroDocumento: BigInt!`.
3. THE GraphQL_Client SHALL seleccionar los campos de `cliente360` dentro de un inline fragment `... on Cliente360NaturalType { ... }`.
4. THE GraphQL_Client SHALL enviar `numeroDocumento` como valor numérico JSON en las variables.
5. WHEN el `Conecta_GraphQL_Endpoint` responde `200` con `data.cliente` no nulo y sin `errors`, THE GraphQL_Client SHALL retornar los datos del cliente a la capa de orquestación.
6. WHEN el `Conecta_GraphQL_Endpoint` responde con `errors` en el cuerpo, THE GraphQL_Client SHALL continuar traduciendo la falla a `UPSTREAM_ERROR` sin exponer el detalle al cliente (comportamiento existente, sin cambios).

### Requirement 2: Tipos externos alineados con la respuesta real

**User Story:** Como mantenedor del backend, quiero que los tipos de `ConectaClienteData` reflejen la forma real de la respuesta, para que el tipado estático no oculte defectos y las transformaciones operen sobre los tipos correctos.

#### Acceptance Criteria

1. THE tipo `ConectaClienteData` SHALL declarar `numeroCelular` (en `mejorCelular` y en cada elemento de `celulares`) como `number | string | null`.
2. THE tipo `ConectaClienteData` SHALL declarar `aptoAutos`, `aptoHogar`, `aptoSalud`, `aptoVida` como `string | null`.
3. THE tipos `edad`, `valorIngresos`, `antiguedad` SHALL permanecer como `number | null` (sin cambios).
4. THE tipos `fuente`, `clv`, `categoriaIngresos`, `ciudad`, `productoRecomendado` SHALL permanecer como `string | null` (sin cambios).

### Requirement 3: Enmascaramiento correcto del número de celular numérico

**User Story:** Como responsable de cumplimiento (Habeas Data), quiero que el `numeroCelular` se enmascare correctamente aunque llegue como número, para no exponer el número completo ni romper la transformación.

#### Acceptance Criteria

1. WHEN `numeroCelular` es un valor numérico, THE PII_Masking SHALL convertirlo a su representación en dígitos antes de enmascarar.
2. THE PII_Masking SHALL enmascarar el `numeroCelular` exponiendo únicamente los últimos 4 caracteres significativos, sustituyendo el resto por el carácter de máscara (comportamiento existente de `maskLastFour`).
3. WHEN `numeroCelular` es `null`, indefinido o vacío, THE PII_Masking SHALL producir el valor enmascarado vacío sin exponer dígitos (comportamiento existente).
4. THE `numeroCelular` en el `ClienteResponseDTO` SHALL permanecer tipado como `string` (ya enmascarado), sin cambios en el contrato expuesto al frontend.

### Requirement 4: Representación correcta de los campos de aptitud

**User Story:** Como usuario que revisa el perfil del cliente, quiero ver correctamente si el cliente es apto para cada producto, para tomar decisiones sin datos engañosos.

#### Acceptance Criteria

1. THE `ClienteResponseDTO` SHALL representar `aptoAutos`, `aptoHogar`, `aptoSalud`, `aptoVida` como `string | null`, preservando el valor recibido de Conecta (`"Si"`/`"No"` u otro).
2. WHEN un campo `apto*` está ausente o es `null`, THE Consulta360_Frontend SHALL mostrar el indicador de dato no disponible.
3. WHEN un campo `apto*` tiene un valor, THE Consulta360_Frontend SHALL mostrar ese valor tal como lo entrega el backend, sin interpretarlo como booleano.
4. THE Consulta360_Frontend SHALL dejar de evaluar los campos `apto*` como booleanos (evitar el defecto donde `"No"` se renderiza como `"Sí"`).

### Requirement 5: Verificación end-to-end sin regresiones

**User Story:** Como responsable del despliegue, quiero verificar que la consulta funciona de extremo a extremo y que no se rompió el manejo de errores existente, antes de dar por resuelto el defecto.

#### Acceptance Criteria

1. WHEN se ejecuta una consulta válida contra el `Conecta_GraphQL_Endpoint` real con un documento existente, THE Cliente360_API SHALL responder `200` con `{ found: true, cliente }` y el `numeroCelular` enmascarado.
2. WHEN Conecta no devuelve cliente (`data.cliente` nulo), THE Cliente360_API SHALL responder `200` con `{ found: false }` (sin cambios).
3. THE backend SHALL mantener el mapeo de errores controlados existente (`AUTH_UPSTREAM_FAILED`→502, `UPSTREAM_ERROR`→502, `UPSTREAM_TIMEOUT`→504, `CIRCUIT_OPEN`→503, `VALIDATION_ERROR`→400).
4. THE build/typecheck de backend y frontend SHALL completarse sin errores tras los cambios.
5. THE enmascaramiento SHALL garantizar que ni logs ni respuesta expongan el `numeroCelular` completo.
