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

/** Vehículo registrado en Conecta; sin placa, póliza ni datos de identificación del bien. */
export interface VehiculoDTO {
  readonly linea: string | null;
  readonly marca: string | null;
  readonly modelo: number | string | null;
  readonly tipo: string | null;
  readonly uso: string | null;
}

/** Inmueble registrado en Conecta; sin dirección ni barrio. */
export interface InmuebleDTO {
  readonly ciudad: string | null;
  readonly estrato: number | string | null;
  readonly tipoInmueble: string | null;
}

/** Plan sugerido por Cliente 360 para cada ramo (p. ej. "Clásico" en autos). */
export interface PlanesSugeridosDTO {
  readonly autos: string | null;
  readonly hogar: string | null;
  readonly salud: string | null;
  readonly vida: string | null;
}

/** Contrato de datos consolidados del cliente devuelto al frontend (allowlist). */
export interface ClienteResponseDTO {
  readonly nombreCompleto: string | null;
  readonly tipoPersona: string | null;
  readonly estadoCliente: string | null;
  readonly segmentoBanco: string | null;
  readonly profesion: string | null;
  readonly actividadEconomica: string | null;
  readonly vehiculos: ReadonlyArray<VehiculoDTO>;
  readonly inmuebles: ReadonlyArray<InmuebleDTO>;
  /** Cantidad de riesgos de hogar registrados. */
  readonly riesgosHogar: number;
  /** Cantidad de siniestros registrados. */
  readonly siniestros: number;
  readonly demografica: {
    readonly edad: number | null;
    readonly departamento: string | null;
    readonly municipio: string | null;
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
    readonly departamento: string | null;
    readonly ocupacion: string | null;
    readonly sectorEconomico: string | null;
    readonly subsectorEconomico: string | null;
    readonly cantidadProductos: number | null;
    /** Productos que el cliente ya tiene con el grupo. */
    readonly productosActuales: ReadonlyArray<string>;
    /** Próximos productos sugeridos por Cliente 360, en orden de prioridad y sin los "No Apto". */
    readonly productosSugeridos: ReadonlyArray<string>;
    readonly planesSugeridos: PlanesSugeridosDTO;
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
