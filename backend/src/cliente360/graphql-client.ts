/**
 * Cliente GraphQL para la consulta consolidada de cliente contra Conecta (Req 5).
 *
 * Ejecuta la consulta `ConsultaCliente360` contra el `Conecta_GraphQL_Endpoint`
 * con los encabezados requeridos: `Content-Type`, `Authorization: Bearer <token>`,
 * `x-user-key` y `X-Correlation-ID` (Req 5.1, 8.3). El `numeroDocumento` se envía
 * como valor numérico JSON (BigInt lógico); los valores del rango de negocio están
 * dentro de `Number.MAX_SAFE_INTEGER`, por lo que no hay pérdida de precisión (Req 5.3).
 *
 * Aplica un `AbortController` con el timeout configurado (15s) que se traduce a un
 * error controlado `UPSTREAM_TIMEOUT` (Req 5.6, 7.2, 7.3). Un cuerpo con `errors`
 * GraphQL produce `UPSTREAM_ERROR` sin exponer el detalle (Req 5.7). La ausencia de
 * `x-user-key` produce `CONFIG_MISSING` sin enviar la solicitud (Req 5.2).
 *
 * Ante un `401`, invalida la caché de token y reintenta una única vez con un token
 * nuevo (Req 5.8); un segundo `401` produce `AUTH_UPSTREAM_FAILED` sin más
 * reintentos (Req 5.9). Nunca se registran token, secretos ni PII: los eventos
 * estructurados incluyen únicamente el `correlationId` y campos seguros (Req 6.5).
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

/**
 * Consulta GraphQL exacta de cliente (fuente única de verdad del diseño).
 *
 * Selecciona los campos demográficos, de contacto, de Cliente 360 y el valor de
 * ingresos definidos en el contrato con Conecta.
 */
const CONSULTA_CLIENTE_QUERY = `query ConsultaCliente360($tipoDocumento: String!, $numeroDocumento: BigInt!) {
  cliente(tipoDocumento: $tipoDocumento, numeroDocumento: $numeroDocumento) {
    demografica { edad }
    contacto {
      mejorCelular { numeroCelular fuente }
      celulares { numeroCelular fuente }
    }
    cliente360 {
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

/** Error controlado ante indisponibilidad o errores GraphQL; sin detalle sensible. */
export class UpstreamError extends Error {
  readonly code = UPSTREAM_ERROR;

  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
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
 * Aplica el timeout configurado vía `AbortController` (Req 5.6, 7.2). Traduce el
 * estado 401 a `unauthorized` para el manejo de reintento en el nivel superior.
 *
 * @param body cuerpo GraphQL ya construido.
 * @param token `OAuth2_Token` vigente para el encabezado `Authorization`.
 * @param correlationId identificador de correlación propagado en la llamada.
 * @returns el resultado del intento (autorizado con datos o marca de 401).
 * @throws {UpstreamTimeoutError} si la llamada excede el timeout configurado.
 * @throws {UpstreamError} ante error de red o errores GraphQL en el cuerpo.
 */
async function executeRequest(
  body: GraphQLRequest,
  token: string,
  correlationId: string,
): Promise<RequestOutcome> {
  const { conecta } = appConfig;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), conecta.graphqlTimeoutMs);

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
      throw new UpstreamError(`GraphQL endpoint responded with status ${response.status}.`);
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

    throw new UpstreamError("GraphQL request failed (network).");
  } finally {
    clearTimeout(timeout);
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

    const firstToken = await tokenService.getToken(correlationId);
    const firstOutcome = await executeRequest(body, firstToken, correlationId);
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
    const retryOutcome = await executeRequest(body, retryToken, correlationId);
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
