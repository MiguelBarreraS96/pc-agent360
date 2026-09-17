import type { ErrorRequestHandler, RequestHandler } from "express";

import { logEvent } from "../logger";

interface ErrorResponse {
  readonly correlationId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

type StatusBearingError = {
  readonly status?: unknown;
  readonly statusCode?: unknown;
};

/** Identify values that may contain an HTTP status without trusting their contents. */
function isStatusBearingError(error: unknown): error is StatusBearingError {
  return typeof error === "object" && error !== null;
}

/** Restrict exposed error statuses to safe client-error codes. */
function resolveResponseStatus(error: unknown): number {
  if (!isStatusBearingError(error)) {
    return 500;
  }

  const candidate = typeof error.status === "number" ? error.status : error.statusCode;
  if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate < 500) {
    return candidate;
  }
  return 500;
}

/** Build a predictable response without exposing internal error details. */
function buildErrorResponse(status: number, correlationId: string): ErrorResponse {
  const isClientError = status >= 400 && status < 500;

  return {
    correlationId,
    error: {
      code: isClientError ? "REQUEST_REJECTED" : "INTERNAL_ERROR",
      message: isClientError ? "Request could not be processed." : "An unexpected error occurred.",
    },
  };
}

/** Return the standard response for unmatched API routes. */
export const notFoundHandler: RequestHandler = (request, response): void => {
  response.status(404).json({
    correlationId: request.correlationId,
    error: {
      code: "NOT_FOUND",
      message: "Resource not found.",
    },
  } satisfies ErrorResponse);
};

/** Return a generic response and log only safe request metadata for failures. */
export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next): void => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = resolveResponseStatus(error);
  logEvent("ERROR", "http_request_failed", {
    correlationId: request.correlationId,
    requestId: request.correlationId,
    statusCode: status,
  });
  response.status(status).json(buildErrorResponse(status, request.correlationId));
};
