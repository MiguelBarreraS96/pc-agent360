/**
 * Tipos externos del servicio Conecta DataOps (contratos OAuth2 y GraphQL).
 *
 * Este módulo contiene solo definiciones de tipos (sin código en tiempo de
 * ejecución). Todos los contratos externos se declaran con tipado estricto y
 * `readonly` para garantizar inmutabilidad en las capas de servicio.
 */

/** Cuerpo de la solicitud de token OAuth2 mediante el flujo `client_credentials`. */
export interface TokenRequest {
  readonly grant_type: "client_credentials";
  readonly client_id: string;
  readonly client_secret: string;
  readonly scope: string;
}

/** Respuesta del `Conecta_Token_Endpoint` con el token de acceso vigente. */
export interface TokenResponse {
  /** Token de acceso de corta duración (OAuth2_Token). */
  readonly access_token: string;
  /** Tipo de token; siempre "Bearer". */
  readonly token_type: string;
  /** Tiempo de vigencia del token, en segundos. */
  readonly expires_in: number;
}

/** Entrada de negocio validada para la consulta de cliente. */
export interface ConsultaInput {
  readonly tipoDocumento: "CC";
  readonly numeroDocumento: number;
}

/** Cuerpo de la solicitud GraphQL enviada al `Conecta_GraphQL_Endpoint`. */
export interface GraphQLRequest {
  readonly query: string;
  readonly variables: {
    readonly tipoDocumento: string;
    /** Serializado como valor numérico JSON (BigInt lógico). */
    readonly numeroDocumento: number;
  };
}

/** Respuesta genérica de GraphQL: datos del cliente o errores controlados. */
export interface GraphQLResponse<T> {
  readonly data?: {
    readonly cliente: T | null;
  };
  readonly errors?: ReadonlyArray<{ readonly message: string }>;
}

/** Datos crudos del cliente devueltos por Conecta antes del enmascaramiento. */
export interface ConectaClienteData {
  readonly nombreCompleto: string | null;
  readonly tipoPersona: string | null;
  readonly estadoCliente: string | null;
  readonly segmentoBanco: string | null;
  readonly profesion: string | null;
  readonly actividadEconomicaSbolivar: string | null;
  readonly demografica: {
    readonly edad: number | null;
    readonly departamento: string | null;
    readonly municipio: string | null;
  } | null;
  readonly vehiculos: ReadonlyArray<{
    readonly vehiculo: {
      readonly marca: string | null;
      readonly linea: string | null;
      readonly modelo: number | string | null;
      readonly tipo: string | null;
      readonly uso: string | null;
    } | null;
  }> | null;
  readonly riesgosHogar: ReadonlyArray<{ readonly tipoInmueble: string | null }> | null;
  readonly inmuebles: ReadonlyArray<{
    readonly tipoInmueble: string | null;
    readonly estrato: number | string | null;
    readonly ciudad: string | null;
  }> | null;
  readonly siniestros: ReadonlyArray<{ readonly estadoSiniestro: string | null }> | null;
  readonly contacto: {
    readonly mejorCelular: {
      readonly numeroCelular: number | string | null;
      readonly fuente: string | null;
    } | null;
    readonly celulares: ReadonlyArray<{
      readonly numeroCelular: number | string | null;
      readonly fuente: string | null;
    }> | null;
  } | null;
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
    /** Lista JSON serializada como texto, p. ej. `["DEUDORES","ARL"]`. */
    readonly productos: string | null;
    readonly primerProducto: string | null;
    readonly segundoProducto: string | null;
    readonly tercerProducto: string | null;
    readonly cuartoProducto: string | null;
    readonly quintoProducto: string | null;
    readonly productoAutos: string | null;
    readonly productoHogar: string | null;
    readonly productoSalud: string | null;
    readonly productoVida: string | null;
  } | null;
  readonly valorIngresos: number | null;
}
