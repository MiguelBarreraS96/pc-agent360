/**
 * Servicio de token OAuth2 con caché en memoria para el flujo `client_credentials`
 * contra el `Conecta_Token_Endpoint` (Req 4).
 *
 * Mantiene un único token vigente por proceso y lo reutiliza mientras el tiempo
 * restante hasta su expiración supere el margen de refresco configurado
 * (`tokenRefreshMarginMs`, Req 4.3); en caso contrario solicita uno nuevo
 * (Req 4.4). Ante error o timeout de la solicitud saliente, conserva la caché
 * vigente si existía y lanza un error controlado `AUTH_UPSTREAM_FAILED` (Req 4.5).
 *
 * Este módulo nunca registra el token, el `client_id` ni el `client_secret`
 * (Req 4.6, 6.5); solo emite eventos estructurados con metadatos no sensibles.
 */

import { appConfig } from "../config";
import { logEvent } from "../logger";

import type { TokenRequest, TokenResponse } from "./conecta-types";

/** Código controlado que identifica el fallo de autenticación externa (Req 4.5). */
export const AUTH_UPSTREAM_FAILED_CODE = "AUTH_UPSTREAM_FAILED";

/** Estado HTTP con el que la orquestación mapea el fallo de autenticación (Req 4.5). */
const AUTH_UPSTREAM_FAILED_STATUS = 502;

/** Token en caché junto al instante absoluto de expiración en milisegundos. */
interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/** Contrato del servicio de token OAuth2. */
export interface TokenService {
  /** Devuelve un token vigente, reusando la caché o refrescando según el margen. */
  getToken(correlationId: string): Promise<string>;
  /** Invalida la caché para forzar un refresco (llamado ante 401 del GraphQL). */
  invalidate(): void;
}

/**
 * Error controlado que se lanza cuando la autenticación externa falla o expira.
 *
 * Es identificable por su propiedad `code = "AUTH_UPSTREAM_FAILED"` y su `status`
 * para que la orquestación lo mapee a `502` sin exponer detalles internos ni
 * secretos al cliente (Req 4.5, 3.8, 5.9). El `message` describe la causa técnica
 * para el registro interno; nunca contiene token, `client_id` ni `client_secret`.
 */
export class AuthUpstreamError extends Error {
  readonly code: typeof AUTH_UPSTREAM_FAILED_CODE = AUTH_UPSTREAM_FAILED_CODE;
  readonly status: typeof AUTH_UPSTREAM_FAILED_STATUS = AUTH_UPSTREAM_FAILED_STATUS;

  constructor(message = "El servicio externo no está disponible.") {
    super(message);
    this.name = "AuthUpstreamError";
  }
}

/** Determina si un error es un fallo controlado de autenticación externa. */
export function isAuthUpstreamError(error: unknown): error is AuthUpstreamError {
  return error instanceof AuthUpstreamError;
}

/** Caché en memoria del módulo: token vigente o `null` si no hay ninguno. */
let cachedToken: CachedToken | null = null;

/** Verifica que la respuesta cruda del endpoint tenga la forma de `TokenResponse`. */
function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === "string" &&
    candidate.access_token.trim() !== "" &&
    typeof candidate.token_type === "string" &&
    typeof candidate.expires_in === "number" &&
    Number.isFinite(candidate.expires_in) &&
    candidate.expires_in > 0
  );
}

/**
 * Indica si el token en caché sigue siendo reutilizable en el instante `nowMs`.
 *
 * Reutiliza mientras el tiempo restante hasta la expiración supere el margen de
 * refresco configurado; en el margen (o por debajo) fuerza el refresco (Req 4.3).
 */
function isReusable(token: CachedToken, nowMs: number): boolean {
  return token.expiresAtMs - nowMs > appConfig.conecta.tokenRefreshMarginMs;
}

/**
 * Solicita un token nuevo al `Conecta_Token_Endpoint` mediante `client_credentials`.
 *
 * Envía un `POST` con `Content-Type: application/json`, propaga el
 * `X-Correlation-ID` y aplica un timeout de `tokenTimeoutMs` con `AbortController`
 * (Req 4.1, 7.1, 8.3). Nunca registra el cuerpo ni los secretos enviados.
 *
 * @param correlationId identificador de correlación de la solicitud entrante.
 * @returns el token en caché resultante con su instante de expiración.
 * @throws {AuthUpstreamError} ante error de red, timeout o respuesta inválida.
 */
async function requestToken(correlationId: string): Promise<CachedToken> {
  const { tokenUrl, clientId, clientSecret, scope, tokenTimeoutMs } = appConfig.conecta;

  const requestBody: TokenRequest = {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), tokenTimeoutMs);

  const requestedAtMs = Date.now();
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AuthUpstreamError("Token endpoint responded with a non-success status.");
    }

    const payload: unknown = await response.json();
    if (!isTokenResponse(payload)) {
      throw new AuthUpstreamError("Token endpoint returned an invalid payload.");
    }

    return {
      accessToken: payload.access_token,
      expiresAtMs: requestedAtMs + payload.expires_in * 1000,
    };
  } catch (error) {
    if (isAuthUpstreamError(error)) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AuthUpstreamError("Token request timed out.");
    }

    throw new AuthUpstreamError("Token request failed (network).");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Devuelve un token OAuth2 vigente, reutilizando la caché mientras esté dentro del
 * margen de refresco o solicitando uno nuevo en caso contrario (Req 4.3, 4.4).
 *
 * Si la solicitud saliente falla o expira, conserva la caché vigente (si existía)
 * y propaga un `AuthUpstreamFailedError` (Req 4.5). No registra el token ni los
 * secretos en ningún caso (Req 4.6).
 *
 * @param correlationId identificador de correlación de la solicitud entrante.
 * @returns el `OAuth2_Token` de acceso vigente.
 * @throws {AuthUpstreamError} cuando no es posible obtener un token válido.
 */
async function getToken(correlationId: string): Promise<string> {
  const nowMs = Date.now();
  if (cachedToken !== null && isReusable(cachedToken, nowMs)) {
    logEvent("INFO", "conecta_token_cache_hit", {
      correlationId,
      requestId: correlationId,
    });
    return cachedToken.accessToken;
  }

  try {
    const token = await requestToken(correlationId);
    cachedToken = token;
    logEvent("INFO", "conecta_token_refreshed", {
      correlationId,
      requestId: correlationId,
    });
    return token.accessToken;
  } catch (error) {
    logEvent("ERROR", "conecta_token_request_failed", {
      correlationId,
      requestId: correlationId,
      cacheRetained: cachedToken !== null,
    });

    if (isAuthUpstreamError(error)) {
      throw error;
    }

    throw new AuthUpstreamError();
  }
}

/** Limpia la caché en memoria para forzar un refresco en el reintento 401 (Req 5.8). */
function invalidate(): void {
  cachedToken = null;
}

/** Instancia única del servicio de token compartida por el proceso. */
export const tokenService: TokenService = {
  getToken,
  invalidate,
};
