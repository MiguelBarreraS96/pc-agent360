import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { logEvent } from "../logger";

const CORRELATION_ID_HEADER = "X-Correlation-ID";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Determine whether a provided identifier is a UUID v4 suitable for tracing. */
function isValidCorrelationId(value: string | undefined): value is string {
  return value !== undefined && UUID_V4_PATTERN.test(value);
}

/** Preserve a valid caller correlation ID or create a new traceable identifier. */
function resolveCorrelationId(value: string | undefined): string {
  return isValidCorrelationId(value) ? value : randomUUID();
}

/** Attach a safe correlation ID to the request, response, and completion log. */
export const correlationIdMiddleware: RequestHandler = (request, response, next): void => {
  const correlationId = resolveCorrelationId(request.get(CORRELATION_ID_HEADER));
  request.correlationId = correlationId;
  response.setHeader(CORRELATION_ID_HEADER, correlationId);

  response.on("finish", () => {
    logEvent("INFO", "http_request_completed", {
      correlationId,
      requestId: correlationId,
      method: request.method,
      statusCode: response.statusCode,
    });
  });

  next();
};
