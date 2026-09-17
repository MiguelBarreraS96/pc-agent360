/**
 * Modelos de tipos del feature Consulta Cliente 360 (frontend).
 *
 * Este archivo contiene únicamente definiciones de tipos (types-only). Espeja el
 * contrato de respuesta expuesto por el backend (`Cliente360_API`) y agrega los
 * tipos de solicitud y de estado de vista que usa el componente Angular.
 *
 * El DTO de respuesta (`ClienteResponseDTO`, `CelularDTO`, `ConsultaApiResponse`)
 * es un espejo estricto del contrato del backend en
 * `backend/src/cliente360/cliente360-dto.ts`. La PII ya llega enmascarada desde el
 * backend; el frontend no realiza enmascaramiento adicional.
 */

/**
 * Solicitud enviada al `Cliente360_API`. En esta versión el único tipo de
 * documento soportado es `CC` y el número de documento viaja como entero positivo
 * (el componente convierte la cadena de dígitos capturada a `number` antes de
 * enviarla). (Req 2.2)
 */
export interface ConsultaRequest {
  readonly tipoDocumento: 'CC';
  readonly numeroDocumento: number;
}

/**
 * Celular enmascarado recibido del backend: `numeroCelular` expone solo los
 * últimos 4 dígitos; el resto ya viene sustituido por el carácter de máscara.
 */
export interface CelularDTO {
  readonly numeroCelular: string;
  readonly fuente: string | null;
}

/**
 * Contrato de datos consolidados del cliente recibido del backend (allowlist).
 * Espejo estricto de `ClienteResponseDTO` del backend. Los campos que pueden
 * llegar ausentes se representan como `null` y el componente muestra un indicador
 * de dato no disponible para cada uno. (Req 2.2, 2.3)
 */
export interface ClienteResponseDTO {
  readonly demografica: {
    readonly edad: number | null;
  };
  readonly contacto: {
    readonly mejorCelular: CelularDTO | null;
    readonly celulares: ReadonlyArray<CelularDTO>;
  };
  readonly cliente360: {
    readonly clv: string | null;
    readonly categoriaIngresos: string | null;
    readonly antiguedad: number | null;
    readonly ciudad: string | null;
    readonly productoRecomendado: string | null;
    readonly aptoAutos: string | null;
    readonly aptoHogar: string | null;
    readonly aptoSalud: string | null;
    readonly aptoVida: string | null;
  };
  readonly valorIngresos: number | null;
}

/**
 * Cuerpo de respuesta HTTP del backend (`200 OK`). Discrimina entre "cliente
 * encontrado" y "sin información". Espejo estricto de `ConsultaApiResponse` del
 * backend; el caso `{ found: false }` diferencia la ausencia de datos de un error
 * técnico. (Req 2.4)
 */
export type ConsultaApiResponse =
  | { readonly found: true; readonly cliente: ClienteResponseDTO }
  | { readonly found: false };

/**
 * Estado de la vista de resultados. Gobierna qué se renderiza en el área de
 * resultados durante el ciclo de vida de una consulta. (Req 2.4, 2.5, 2.6, 2.7)
 */
export type ViewState = 'idle' | 'loading' | 'success' | 'noData' | 'error';

/**
 * Resultado tipado de una consulta ya normalizado por el servicio del frontend.
 * Unión discriminada por `kind` que el componente mapea directamente al
 * `ViewState` correspondiente. (Req 2.2, 2.3, 2.4)
 */
export type ConsultaResult =
  | { readonly kind: 'success'; readonly cliente: ClienteResponseDTO }
  | { readonly kind: 'noData' }
  | { readonly kind: 'error' };
