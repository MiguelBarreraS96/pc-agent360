/**
 * Cliente GraphQL para la consulta consolidada de cliente contra Conecta (Req 5).
 *
 * Ejecuta la consulta `ConsultaCliente360` contra el `Conecta_GraphQL_Endpoint`
 * con los encabezados requeridos: `Content-Type`, `Authorization: Bearer <token>`,
 * `x-user-key` y `X-Correlation-ID` (Req 5.1, 8.3). El `numeroDocumento` se envía
 * como valor numérico JSON (BigInt lógico); los valores del rango de negocio están
 * dentro de `Number.MAX_SAFE_INTEGER`, por lo que no hay pérdida de precisión (Req 5.3).
 *
 * Aplica un `AbortController` con el timeout configurado (`CONECTA_GRAPHQL_TIMEOUT_MS`,
 * 25s por defecto) que se traduce a un error controlado `UPSTREAM_TIMEOUT` (Req 5.6,
 * 7.2, 7.3). Un cuerpo con `errors` GraphQL produce `UPSTREAM_ERROR` sin exponer el
 * detalle (Req 5.7). La ausencia de `x-user-key` produce `CONFIG_MISSING` sin enviar
 * la solicitud (Req 5.2).
 *
 * La consulta es de solo lectura (idempotente): ante un timeout, un error de red o un
 * `5xx` del endpoint GraphQL se reintenta exactamente una vez, con una breve espera y
 * sin exceder el presupuesto total `CONECTA_GRAPHQL_TOTAL_BUDGET_MS` (45s por defecto,
 * muy por debajo del `--timeout` de Cloud Run). No se reintenta ante `errors` en el
 * cuerpo GraphQL ni ante un `4xx` distinto de `401`.
 *
 * Ante un `401`, invalida la caché de token y reintenta una única vez con un token
 * nuevo (Req 5.8); un segundo `401` produce `AUTH_UPSTREAM_FAILED` sin más
 * reintentos (Req 5.9). Este reintento por autenticación y el reintento transitorio
 * son independientes entre sí; cada uno está acotado a un único intento adicional, por
 * lo que no hay riesgo de bucles sin límite. Nunca se registran token, secretos ni PII:
 * los eventos estructurados incluyen únicamente el `correlationId` y campos seguros
 * (Req 6.5).
 */

import { appConfig } from "../config";
import { logEvent } from "../logger";
import type { ConectaClienteData, ConsultaInput, GraphQLRequest, GraphQLResponse } from "./conecta-types";
import { AuthUpstreamError, tokenService } from "./token-service";

/** Código de error controlado ante timeout del endpoint GraphQL. */
export const UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT";

/** Código de error controlado ante fallas/errores del endpoint GraphQL. */
export const UPSTREAM_ERROR = "UPSTREAM_ERROR";

/** Código de error controlado ante configuración faltante (`x-user-key`). */
export const CONFIG_MISSING = "CONFIG_MISSING";

/** Estado HTTP que dispara la invalidación de token y el reintento único. */
const HTTP_UNAUTHORIZED = 401;

/** Umbral de estado HTTP a partir del cual una respuesta no-ok se considera transitoria. */
const HTTP_SERVER_ERROR_THRESHOLD = 500;

/** Espera breve antes del único reintento transitorio (timeout, red o 5xx). */
const TRANSIENT_RETRY_DELAY_MS = 400;

/** Margen mínimo de presupuesto restante para intentar el reintento transitorio. */
const MIN_RETRY_BUDGET_MS = TRANSIENT_RETRY_DELAY_MS + 1000;

/**
 * Consulta GraphQL exacta de cliente (fuente única de verdad del diseño).
 *
 * El argumento de negocio va anidado en el input `cliente` de tipo `ClienteInput!`
 * (`cliente(cliente: { tipoDocumento, numeroDocumento })`). Los campos de Cliente 360
 * se seleccionan mediante el inline fragment `... on Cliente360NaturalType`, ya que
 * `cliente360` es un tipo union en el esquema de Conecta. Selecciona los campos
 * demográficos, de contacto, de Cliente 360 y el valor de ingresos del contrato.
 */
const CONSULTA_CLIENTE_QUERY = `query ConsultaCliente360($tipoDocumento: String!, $numeroDocumento: BigInt!) {
  cliente(cliente: { tipoDocumento: $tipoDocumento, numeroDocumento: $numeroDocumento }) {
    nombreCompleto
    tipoPersona
    estadoCliente
    segmentoBanco
    profesion
    actividadEconomicaSbolivar
    demografica { edad departamento municipio }
    contacto {
      mejorCelular { numeroCelular fuente }
      celulares { numeroCelular fuente }
    }
    vehiculos { vehiculo { marca linea modelo tipo uso } }
    riesgosHogar { tipoInmueble }
    inmuebles { tipoInmueble estrato ciudad }
    siniestros { estadoSiniestro }
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
        departamento
        ocupacion
        sectorEconomico
        subsectorEconomico
        cantidadProductos
        productos
        primerProducto
        segundoProducto
        tercerProducto
        cuartoProducto
        quintoProducto
        productoAutos
        productoHogar
        productoSalud
        productoVida
      }
    }
    valorIngresos
  }
}`;

/** Contrato del cliente GraphQL consumido por la capa de orquestación. */
export interface GraphQLClient {
  /** Ejecuta la consulta de cliente; reintenta una vez ante 401 (Req 5.8, 5.9). */
  consultarCliente(input: ConsultaInput, correlationId: string): Promise<ConectaClienteData | null>;
}

/** Error controlado ante timeout del endpoint GraphQL; oculta el detalle al cliente. */
export class UpstreamTimeoutError extends Error {
  readonly code = UPSTREAM_TIMEOUT;

  constructor(message: string) {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

/** Opciones del error `UpstreamError` para clasificar si el fallo es transitorio. */
interface UpstreamErrorOptions {
  /** Estado HTTP devuelto por el endpoint, cuando el error viene de una respuesta no-ok. */
  readonly status?: number;
  /** `true` cuando el fallo es transitorio (red o `5xx`) y admite el reintento único. */
  readonly retryable?: boolean;
}

/** Error controlado ante indisponibilidad o errores GraphQL; sin detalle sensible. */
export class UpstreamError extends Error {
  readonly code = UPSTREAM_ERROR;
  /** Estado HTTP de la respuesta, cuando aplica (ausente ante fallo de red). */
  readonly status: number | undefined;
  /** `true` si el fallo es transitorio (red o `5xx`) y habilita el reintento único. */
  readonly retryable: boolean;

  constructor(message: string, options: UpstreamErrorOptions = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** Error controlado ante configuración faltante; nunca expone el valor del secreto. */
export class ConfigMissingError extends Error {
  readonly code = CONFIG_MISSING;

  constructor(message: string) {
    super(message);
    this.name = "ConfigMissingError";
  }
}

/** Resultado interno de un intento de consulta GraphQL. */
interface RequestOutcome {
  /** `true` si el endpoint respondió con estado 401 (dispara reintento). */
  readonly unauthorized: boolean;
  /** Datos del cliente cuando la respuesta fue satisfactoria; nulo si no hay cliente. */
  readonly cliente?: ConectaClienteData | null;
}

/**
 * Construye el cuerpo GraphQL con la consulta y las variables tipadas.
 *
 * @param input entrada de negocio validada (tipo y número de documento).
 * @returns la solicitud GraphQL con `numeroDocumento` como valor numérico.
 */
function buildRequestBody(input: ConsultaInput): GraphQLRequest {
  return {
    query: CONSULTA_CLIENTE_QUERY,
    variables: {
      tipoDocumento: input.tipoDocumento,
      numeroDocumento: input.numeroDocumento,
    },
  };
}

/**
 * Ejecuta un único intento de consulta GraphQL con el token indicado.
 *
 * Aplica el timeout recibido vía `AbortController` (Req 5.6, 7.2): el llamador decide
 * su valor para respetar el presupuesto total restante. Traduce el estado 401 a
 * `unauthorized` para el manejo de reintento en el nivel superior. Un `5xx` o un error
 * de red producen un `UpstreamError` con `retryable = true` para que el llamador pueda
 * aplicar el único reintento transitorio; un `4xx` distinto de 401 o un cuerpo con
 * `errors` GraphQL producen `retryable = false`.
 *
 * @param body cuerpo GraphQL ya construido.
 * @param token `OAuth2_Token` vigente para el encabezado `Authorization`.
 * @param correlationId identificador de correlación propagado en la llamada.
 * @param timeoutMs timeout de este intento, acotado por el presupuesto total restante.
 * @returns el resultado del intento (autorizado con datos o marca de 401).
 * @throws {UpstreamTimeoutError} si la llamada excede `timeoutMs`.
 * @throws {UpstreamError} ante error de red, `5xx`/`4xx` no-ok o errores GraphQL en el cuerpo.
 */
async function executeRequest(
  body: GraphQLRequest,
  token: string,
  correlationId: string,
  timeoutMs: number,
): Promise<RequestOutcome> {
  const { conecta } = appConfig;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(conecta.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-user-key": conecta.xUserKey,
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === HTTP_UNAUTHORIZED) {
      return { unauthorized: true };
    }

    if (!response.ok) {
      const retryable = response.status >= HTTP_SERVER_ERROR_THRESHOLD;
      throw new UpstreamError(`GraphQL endpoint responded with status ${response.status}.`, {
        status: response.status,
        retryable,
      });
    }

    const payload = (await response.json()) as GraphQLResponse<ConectaClienteData>;
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new UpstreamError("GraphQL endpoint returned errors.");
    }

    return { unauthorized: false, cliente: payload.data?.cliente ?? null };
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamTimeoutError("GraphQL request timed out.");
    }

    throw new UpstreamError("GraphQL request failed (network).", { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

/** Determina si un error de un intento admite el único reintento transitorio. */
function isRetryableTransientError(error: unknown): boolean {
  if (error instanceof UpstreamTimeoutError) {
    return true;
  }

  return error instanceof UpstreamError && error.retryable;
}

/** Espera `ms` milisegundos; usada antes del único reintento transitorio. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta un intento GraphQL con, como máximo, un único reintento transitorio.
 *
 * Ante `UpstreamTimeoutError` o `UpstreamError` con `retryable = true` (timeout, red o
 * `5xx`), espera `TRANSIENT_RETRY_DELAY_MS` y reintenta una sola vez con el mismo
 * token, siempre que quede presupuesto suficiente en `deadlineMs`. No reintenta ante
 * `401` (lo maneja el llamador) ni ante errores no transitorios (`4xx`, `errors` GraphQL).
 *
 * @param body cuerpo GraphQL ya construido.
 * @param token `OAuth2_Token` vigente para el encabezado `Authorization`.
 * @param correlationId identificador de correlación propagado en la llamada.
 * @param deadlineMs instante absoluto (`Date.now()`) hasta el que se admite reintentar.
 * @returns el resultado del último intento realizado.
 */
async function executeWithTransientRetry(
  body: GraphQLRequest,
  token: string,
  correlationId: string,
  deadlineMs: number,
): Promise<RequestOutcome> {
  const { conecta } = appConfig;
  const firstTimeoutMs = Math.min(conecta.graphqlTimeoutMs, Math.max(deadlineMs - Date.now(), 0));

  try {
    return await executeRequest(body, token, correlationId, firstTimeoutMs);
  } catch (error) {
    if (!isRetryableTransientError(error)) {
      throw error;
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs < MIN_RETRY_BUDGET_MS) {
      logEvent("WARN", "Reintento GraphQL omitido: presupuesto insuficiente.", {
        correlationId,
        requestId: correlationId,
        reason: error instanceof UpstreamTimeoutError ? UPSTREAM_TIMEOUT : UPSTREAM_ERROR,
      });
      throw error;
    }

    logEvent("WARN", "Reintento GraphQL por falla transitoria.", {
      correlationId,
      requestId: correlationId,
      reason: error instanceof UpstreamTimeoutError ? UPSTREAM_TIMEOUT : UPSTREAM_ERROR,
    });
    await delay(TRANSIENT_RETRY_DELAY_MS);

    const retryTimeoutMs = Math.min(conecta.graphqlTimeoutMs, Math.max(deadlineMs - Date.now(), 0));
    return executeRequest(body, token, correlationId, retryTimeoutMs);
  }
}

/**
 * Cliente GraphQL singleton para la consulta consolidada de cliente.
 *
 * Se exporta como objeto para que la capa de orquestación lo importe directamente
 * sin instanciación adicional (mismo patrón que `tokenService`).
 */
export const graphqlClient: GraphQLClient = {
  async consultarCliente(input: ConsultaInput, correlationId: string): Promise<ConectaClienteData | null> {
    const { conecta } = appConfig;
    if (conecta.xUserKey.trim() === "") {
      logEvent("ERROR", "Configuración faltante para la consulta GraphQL.", {
        correlationId,
        requestId: correlationId,
        code: CONFIG_MISSING,
      });
      throw new ConfigMissingError("Missing required configuration: x-user-key.");
    }

    const body = buildRequestBody(input);
    // Presupuesto total del intento completo (incluye el reintento por 401 y el
    // reintento transitorio), medido desde antes de la primera solicitud de token para
    // que la latencia acumulada nunca se acerque al `--timeout` de Cloud Run.
    const deadlineMs = Date.now() + conecta.graphqlTotalBudgetMs;

    const firstToken = await tokenService.getToken(correlationId);
    const firstOutcome = await executeWithTransientRetry(body, firstToken, correlationId, deadlineMs);
    if (!firstOutcome.unauthorized) {
      logEvent("INFO", "Consulta GraphQL completada.", {
        correlationId,
        requestId: correlationId,
        retried: false,
      });
      return firstOutcome.cliente ?? null;
    }

    tokenService.invalidate();
    const retryToken = await tokenService.getToken(correlationId);
    const retryOutcome = await executeWithTransientRetry(body, retryToken, correlationId, deadlineMs);
    if (retryOutcome.unauthorized) {
      logEvent("ERROR", "Reintento GraphQL rechazado con 401.", {
        correlationId,
        requestId: correlationId,
        code: "AUTH_UPSTREAM_FAILED",
      });
      throw new AuthUpstreamError("GraphQL rejected the token after a single retry.");
    }

    logEvent("INFO", "Consulta GraphQL completada tras reintento.", {
      correlationId,
      requestId: correlationId,
      retried: true,
    });
    return retryOutcome.cliente ?? null;
  },
};
