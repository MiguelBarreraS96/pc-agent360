/**
 * ConsultaClienteService — servicio del frontend que envía la consulta de cliente
 * al backend propio (`Cliente360_API`, patrón Backend for Frontend).
 *
 * Responsabilidades:
 * - Invocar únicamente el backend propio; nunca llama al `Conecta_Token_Endpoint`
 *   ni al `Conecta_GraphQL_Endpoint` de forma directa. (Req 1.8, 1.9)
 * - No persistir tokens ni secretos en el navegador: no usa `localStorage`,
 *   `sessionStorage` ni variables globales. (Req 2.8)
 * - Aplicar un tiempo de espera de cliente de 15 s y normalizar la respuesta a un
 *   `ConsultaResult` tipado (éxito / sin datos / error). (Req 2.6)
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import type {
  ConsultaApiResponse,
  ConsultaRequest,
  ConsultaResult,
} from './consulta360-models';

/** Ruta del endpoint del backend, según convención `/dominio/api/v1/funcionalidad/entidad`. */
const CONSULTA_PATH = '/seguros/api/v1/cliente360/consulta';

/** Tiempo de espera máximo de la consulta desde el cliente (Req 2.6). */
const CLIENT_TIMEOUT_MS = 15_000;

/**
 * Normaliza la respuesta del backend a un `ConsultaResult` discriminado.
 * `found: true` → `success` con el cliente; `found: false` → `noData`. (Req 2.4)
 *
 * @param response cuerpo `200 OK` recibido del `Cliente360_API`.
 * @returns el resultado tipado que consume el componente.
 */
function toResult(response: ConsultaApiResponse): ConsultaResult {
  if (response.found) {
    return { kind: 'success', cliente: response.cliente };
  }
  return { kind: 'noData' };
}

@Injectable({ providedIn: 'root' })
export class ConsultaClienteService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /**
   * Envía la consulta al backend propio y devuelve el resultado tipado.
   * Ante timeout (15 s) o cualquier error de red/HTTP, resuelve a
   * `{ kind: 'error' }` sin exponer detalles técnicos. (Req 2.6, 2.7)
   *
   * @param request tipo y número de documento a consultar.
   * @returns un `Observable` que emite exactamente un `ConsultaResult`.
   */
  consultar(request: ConsultaRequest): Observable<ConsultaResult> {
    return this.http
      .post<ConsultaApiResponse>(`${this.baseUrl}${CONSULTA_PATH}`, request)
      .pipe(
        timeout(CLIENT_TIMEOUT_MS),
        map(toResult),
        catchError(() => of<ConsultaResult>({ kind: 'error' })),
      );
  }
}
