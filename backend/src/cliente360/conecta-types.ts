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
  readonly demografica: {
    readonly edad: number | null;
  } | null;
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
  } | null;
  readonly valorIngresos: number | null;
}
