/**
 * DTO de respuesta enmascarado (allowlist estricta) del endpoint Cliente360_API.
 *
 * Estos tipos definen el ÚNICO contrato que el backend expone al frontend. Actúan
 * como una allowlist: solo las claves declaradas aquí se serializan en la respuesta,
 * descartando cualquier campo adicional recibido desde el Conecta_GraphQL_Endpoint
 * y evitando exponer el objeto completo (Req 6.4).
 */

/** Celular enmascarado: `numeroCelular` expone solo los últimos 4 dígitos (Req 6.1, 6.2). */
export interface CelularDTO {
  readonly numeroCelular: string;
  readonly fuente: string | null;
}

/** Contrato de datos consolidados del cliente devuelto al frontend (allowlist). */
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
    readonly aptoAutos: boolean | null;
    readonly aptoHogar: boolean | null;
    readonly aptoSalud: boolean | null;
    readonly aptoVida: boolean | null;
  };
  readonly valorIngresos: number | null;
}

/**
 * Resultado discriminado de la consulta: éxito con datos de cliente o ausencia de
 * información. El caso `{ found: false }` distingue "no existe cliente" (resultado
 * de negocio válido) de un error técnico (Req 2.4).
 */
export type ConsultaApiResponse =
  | { readonly found: true; readonly cliente: ClienteResponseDTO }
  | { readonly found: false };
