import type { ErrorRequestHandler, RequestHandler } from "express";

import { isApiError, type ApiErrorCode } from "../errors";
import { logEvent } from "../logger";

interface ErrorResponse {
  readonly correlationId: string;
  readonly error: {
    readonly code: ApiErrorCode | "INTERNAL_ERROR" | "NOT_FOUND";
    readonly message: string;
  };
}

interface ResolvedError {
  readonly code: ApiErrorCode | "INTERNAL_ERROR";
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500;
}

/** Resolve safe client-facing statuses without exposing causes, database messages, or inputs. */
function resolveError(error: unknown): ResolvedError {
  if (isApiError(error)) {
    return { code: error.code, status: error.status };
  }

  if (isMalformedJsonBody(error)) {
    return { code: "BAD_REQUEST", status: 400 };
  }

  return { code: "INTERNAL_ERROR", status: 500 };
}

/** Identify malformed JSON emitted by Express without retaining its raw request body. */
function isMalformedJsonBody(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error) || !("type" in error)) {
    return false;
  }

  return error.status === 400 && error.type === "entity.parse.failed";
}

/** Return fixed generic messages that never contain validation, authorization, or database details. */
function errorMessage(code: ResolvedError["code"] | "NOT_FOUND"): string {
  switch (code) {
    case "FORBIDDEN":
      return "Access is denied.";
    case "NOT_FOUND":
      return "Resource not found.";
    case "UNAUTHENTICATED":
      return "Authentication is required.";
    case "BAD_REQUEST":
    case "CONFLICT":
    case "RATE_LIMITED":
      return "Request could not be processed.";
    case "INTERNAL_ERROR":
      return "An unexpected error occurred.";
  }
}

/** Build a predictable response without exposing internal error details. */
function buildErrorResponse(
  code: ResolvedError["code"] | "NOT_FOUND",
  correlationId: string,
): ErrorResponse {
  return {
    correlationId,
    error: {
      code,
      message: errorMessage(code),
    },
  };
}

/** Return the standard response for unmatched API routes. */
export const notFoundHandler: RequestHandler = (request, response): void => {
  response.status(404).json(buildErrorResponse("NOT_FOUND", request.correlationId));
};

/** Return generic errors and log only safe lifecycle metadata for failures. */
export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next): void => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const resolvedError = resolveError(error);
  logEvent("ERROR", "http_request_failed", {
    correlationId: request.correlationId,
    errorCode: resolvedError.code,
    requestId: request.correlationId,
    statusCode: resolvedError.status,
  });
  response.status(resolvedError.status).json(buildErrorResponse(resolvedError.code, request.correlationId));
};
