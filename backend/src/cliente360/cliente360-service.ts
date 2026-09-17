/**
 * Orquestación de la consulta consolidada de cliente (Req 3.2, 3.3, 6, 8).
 *
 * Coordina las capas del BFF para resolver una consulta de negocio ya validada:
 *  1. Obtiene un `OAuth2_Token` vigente vía `tokenService` (reuso de caché o refresco).
 *  2. Ejecuta la consulta GraphQL a Conecta A TRAVÉS del circuit breaker, de modo que
 *     los fallos consecutivos abran el circuito y se rechacen de inmediato (Req 7.4, 7.5).
 *  3. Si Conecta devuelve un cliente, enmascara la PII y construye el DTO allowlist
 *     estricto (`toClienteResponseDTO`), retornando `{ found: true, cliente }` (Req 6.1, 6.4).
 *  4. Si no hay cliente (`null`), retorna `{ found: false }` distinguiendo "no existe
 *     cliente" de un error técnico (Req 2.4, 3).
 *
 * Emite eventos estructurados con `correlationId`, timestamp ISO-8601 (provisto por el
 * `logger`), nivel y resultado, sin registrar jamás el token, los secretos ni la PII
 * (Req 8.3, 8.4, 8.5, 8.6, 6.5). Los errores controlados de las capas inferiores
 * (`AuthUpstreamError`, `UpstreamTimeoutError`, `UpstreamError`, `ConfigMissingError`,
 * `CircuitOpenError`) se propagan sin transformar su `code`, para que el controller los
 * mapee al estado HTTP correspondiente; el detalle sensible nunca llega al cliente.
 */

import { logEvent } from "../logger";

import type { ConsultaApiResponse } from "./cliente360-dto";
import {
  CircuitBreaker,
  createConectaCircuitBreaker,
  isCircuitOpenError,
} from "./circuit-breaker";
import type { ConsultaInput } from "./conecta-types";
import { graphqlClient } from "./graphql-client";
import { UpstreamError, UpstreamTimeoutError } from "./graphql-client";
import { toClienteResponseDTO } from "./pii-masking";
import { isAuthUpstreamError } from "./token-service";

/**
 * Instancia de circuit breaker a nivel de módulo que protege el endpoint GraphQL.
 *
 * Es compartida por todo el proceso para que el conteo de fallos consecutivos y el
 * estado (closed/open/half-open) sean consistentes entre solicitudes (Req 7.4, 7.5).
 */
const conectaBreaker: CircuitBreaker = createConectaCircuitBreaker();

/** Contrato del servicio de orquestación consumido por el controller. */
export interface Cliente360Service {
  /**
   * Resuelve la consulta de cliente orquestando token, breaker, GraphQL y máscara.
   *
   * @param input entrada de negocio ya validada (tipo y número de documento).
   * @param correlationId identificador de correlación propagado a las llamadas salientes.
   * @returns `{ found: true, cliente }` con el DTO enmascarado, o `{ found: false }`.
   * @throws {AuthUpstreamError} ante fallo de autenticación externa (mapea a 502).
   * @throws {UpstreamTimeoutError} ante timeout del endpoint GraphQL (mapea a 504).
   * @throws {UpstreamError} ante errores/indisponibilidad de GraphQL (mapea a 502).
   * @throws {ConfigMissingError} ante configuración faltante (mapea a 502/500).
   * @throws {CircuitOpenError} cuando el breaker está abierto (mapea a 503).
   */
  consultarCliente(input: ConsultaInput, correlationId: string): Promise<ConsultaApiResponse>;
}

/**
 * Deriva una etiqueta de resultado segura para el log estructurado a partir del
 * error controlado, sin exponer el detalle técnico ni datos sensibles (Req 8.6).
 *
 * @param error error capturado durante la orquestación.
 * @returns el `code` del error controlado o `"UNKNOWN"` si no es reconocible.
 */
function resolveErrorCode(error: unknown): string {
  if (isCircuitOpenError(error)) {
    return error.code;
  }

  if (isAuthUpstreamError(error)) {
    return error.code;
  }

  if (error instanceof UpstreamTimeoutError || error instanceof UpstreamError) {
    return error.code;
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { readonly code: unknown }).code === "string"
  ) {
    return (error as { readonly code: string }).code;
  }

  return "UNKNOWN";
}

/**
 * Servicio de orquestación singleton de la consulta de cliente.
 *
 * Se exporta como objeto para que el controller lo importe directamente sin
 * instanciación adicional (mismo patrón que `tokenService` y `graphqlClient`).
 */
export const cliente360Service: Cliente360Service = {
  async consultarCliente(input: ConsultaInput, correlationId: string): Promise<ConsultaApiResponse> {
    try {
      const cliente = await conectaBreaker.execute(() =>
        graphqlClient.consultarCliente(input, correlationId),
      );

      if (cliente === null) {
        logEvent("INFO", "cliente360_consulta_sin_datos", {
          correlationId,
          requestId: correlationId,
          resultado: "NOT_FOUND",
        });
        return { found: false };
      }

      const dto = toClienteResponseDTO(cliente);
      logEvent("INFO", "cliente360_consulta_exitosa", {
        correlationId,
        requestId: correlationId,
        resultado: "FOUND",
      });
      return { found: true, cliente: dto };
    } catch (error) {
      logEvent("ERROR", "cliente360_consulta_fallida", {
        correlationId,
        requestId: correlationId,
        resultado: "ERROR",
        code: resolveErrorCode(error),
      });
      throw error;
    }
  },
};
