import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { ApiErrorResponse } from './api.models';

const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ErrorRecord = Record<string, unknown>;

/** Converts API errors into safe messages without exposing backend implementation details. */
@Injectable({ providedIn: 'root' })
export class ApiErrorService {
  /** Return a generic, actionable message appropriate for the received failure. */
  messageFor(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'No fue posible completar la operación. Inténtelo nuevamente.';
    }

    switch (error.status) {
      case 400:
        return 'Revise los datos ingresados e inténtelo nuevamente.';
      case 401:
        return 'Su sesión ya no está disponible. Inicie sesión nuevamente.';
      case 403:
        return 'No cuenta con permisos para realizar esta operación.';
      case 404:
        return 'El recurso solicitado ya no está disponible.';
      case 409:
        return 'No fue posible aplicar el cambio por el estado actual de la información.';
      default:
        return 'No fue posible completar la operación. Inténtelo nuevamente.';
    }
  }

  /** Return a validated correlation identifier for support when the API provided one. */
  correlationIdFor(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse)) {
      return null;
    }

    const responseHeader = error.headers.get('X-Correlation-ID');
    if (isCorrelationId(responseHeader)) {
      return responseHeader;
    }

    const response = asApiErrorResponse(error.error);
    return response !== null && isCorrelationId(response.correlationId) ? response.correlationId : null;
  }
}

/** Narrow an unknown response body to the documented error envelope. */
function asApiErrorResponse(value: unknown): ApiErrorResponse | null {
  if (!isRecord(value) || typeof value['correlationId'] !== 'string' || !isRecord(value['error'])) {
    return null;
  }

  const error = value['error'];
  if (typeof error['code'] !== 'string' || typeof error['message'] !== 'string') {
    return null;
  }

  return {
    correlationId: value['correlationId'],
    error: {
      code: error['code'],
      message: error['message'],
    },
  };
}

/** Confirm that an external value is a non-null, non-array object. */
function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Restrict displayed support identifiers to the expected UUID v4 format. */
function isCorrelationId(value: string | null): value is string {
  return value !== null && CORRELATION_ID_PATTERN.test(value);
}
