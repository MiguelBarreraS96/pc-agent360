/**
 * Controller HTTP del endpoint de consulta Cliente 360 (Req 3.4-3.9, 2.4).
 *
 * Responsabilidad única: traducir entre el mundo HTTP y la capa de orquestación.
 *  1. Valida el cuerpo con el schema Zod (`consultaSchema.safeParse`) ANTES de invocar
 *     cualquier servicio externo; ante fallo responde `400` con
 *     `{ correlationId, error: { code: "VALIDATION_ERROR", message, field } }` (Req 3.4-3.7).
 *  2. En éxito delega en `cliente360Service.consultarCliente(input, correlationId)`.
 *  3. Responde `200 { found: true, cliente }` o `200 { found: false }` según el resultado
 *     de negocio, distinguiendo "no existe cliente" de un error técnico (Req 2.4, 3.8).
 *  4. Mapea los errores controlados de las capas inferiores al estado HTTP correspondiente
 *     (400/502/503/504) con la MISMA forma de error `{ correlationId, error: { code, message } }`
 *     que el `errorHandler` global; cualquier error inesperado se delega vía `next(err)` (Req 3.9).
 *
 * Nunca expone detalle técnico ni datos sensibles al cliente: el `message` es genérico y el
 * `code` es un identificador controlado. El `correlationId` proviene del
 * `correlationIdMiddleware`, que lo fija en `request.correlationId`.
 */

import type { RequestHandler } from "express";

import { CIRCUIT_OPEN_CODE } from "./circuit-breaker";
import { cliente360Service } from "./cliente360-service";
import { consultaSchema } from "./cliente360-schema";
import {
  CONFIG_MISSING,
  UPSTREAM_ERROR,
  UPSTREAM_TIMEOUT,
} from "./graphql-client";
import { AUTH_UPSTREAM_FAILED_CODE } from "./token-service";

/** Estado HTTP y código de error controlado para una entrada inválida (Req 3.4-3.7). */
const VALIDATION_ERROR_STATUS = 400;
const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";

/** Códigos de error internos que se consideran fallos de configuración/upstream (502). */
const BAD_GATEWAY_STATUS = 502;
/** Estado para servicio temporalmente indisponible por circuito abierto (503). */
const SERVICE_UNAVAILABLE_STATUS = 503;
/** Estado para timeout del endpoint GraphQL upstream (504). */
const GATEWAY_TIMEOUT_STATUS = 504;

/** Forma de respuesta de error alineada con la del `errorHandler` global. */
interface ErrorResponseBody {
  readonly correlationId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/** Forma de respuesta de error de validación, que además señala el campo inválido. */
interface ValidationErrorResponseBody extends ErrorResponseBody {
  readonly error: {
    readonly code: typeof VALIDATION_ERROR_CODE;
    readonly message: string;
    readonly field: string;
  };
}

/** Mensaje genérico presentado al cliente ante errores de dependencias externas (Req 3.9). */
const UPSTREAM_ERROR_MESSAGE = "No fue posible completar la consulta.";
/** Mensaje genérico ante indisponibilidad temporal por circuito abierto (Req 7.4). */
const SERVICE_UNAVAILABLE_MESSAGE = "El servicio no está disponible temporalmente.";
/** Mensaje genérico ante timeout del servicio externo (Req 7.2). */
const TIMEOUT_MESSAGE = "La consulta tardó demasiado en responder.";
/** Mensaje genérico ante un cuerpo de solicitud inválido (Req 3.4-3.7). */
const VALIDATION_MESSAGE = "El cuerpo de la solicitud no es válido.";

/** Mapeo de estado HTTP y mensaje genérico por cada código de error controlado. */
interface MappedError {
  readonly status: number;
  readonly message: string;
}

/**
 * Traduce el `code` de un error controlado de las capas inferiores a su estado HTTP y
 * mensaje genérico, sin exponer detalle sensible (Req 3.9).
 *
 * @param code código de error controlado propagado por la orquestación.
 * @returns el estado y mensaje a responder, o `null` si el código no es reconocido.
 */
function mapControlledError(code: string): MappedError | null {
  switch (code) {
    case AUTH_UPSTREAM_FAILED_CODE:
    case UPSTREAM_ERROR:
    case CONFIG_MISSING:
      return { status: BAD_GATEWAY_STATUS, message: UPSTREAM_ERROR_MESSAGE };
    case CIRCUIT_OPEN_CODE:
      return { status: SERVICE_UNAVAILABLE_STATUS, message: SERVICE_UNAVAILABLE_MESSAGE };
    case UPSTREAM_TIMEOUT:
      return { status: GATEWAY_TIMEOUT_STATUS, message: TIMEOUT_MESSAGE };
    default:
      return null;
  }
}

/**
 * Extrae de forma segura el `code` (string) de un error desconocido (Zero Trust).
 *
 * @param error error capturado durante la orquestación.
 * @returns el `code` si existe y es string; en otro caso `null`.
 */
function extractErrorCode(error: unknown): string | null {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { readonly code: unknown }).code === "string"
  ) {
    return (error as { readonly code: string }).code;
  }

  return null;
}

/**
 * Maneja `POST /seguros/api/v1/cliente360/consulta`.
 *
 * Valida el cuerpo, delega en la orquestación y traduce el resultado o el error a una
 * respuesta HTTP predecible. Los errores no reconocidos se delegan al `errorHandler`
 * global vía `next(error)`.
 */
export const consultarClienteHandler: RequestHandler = async (request, response, next): Promise<void> => {
  const { correlationId } = request;

  const parsed = consultaSchema.safeParse(request.body);

  if (!parsed.success) {
    const [firstIssue] = parsed.error.issues;
    const field =
      firstIssue === undefined
        ? "body"
        : firstIssue.code === "unrecognized_keys"
          ? (firstIssue.keys[0] ?? "body")
          : firstIssue.path.length > 0
            ? String(firstIssue.path[0])
            : "body";

    response.status(VALIDATION_ERROR_STATUS).json({
      correlationId,
      error: {
        code: VALIDATION_ERROR_CODE,
        message: VALIDATION_MESSAGE,
        field,
      },
    } satisfies ValidationErrorResponseBody);
    return;
  }

  try {
    const result = await cliente360Service.consultarCliente(parsed.data, correlationId);
    response.status(200).json(result);
  } catch (error) {
    const code = extractErrorCode(error);
    const mapped = code === null ? null : mapControlledError(code);

    if (code === null || mapped === null) {
      next(error);
      return;
    }

    response.status(mapped.status).json({
      correlationId,
      error: {
        code,
        message: mapped.message,
      },
    } satisfies ErrorResponseBody);
  }
};
