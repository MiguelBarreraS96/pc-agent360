import { z, type ZodError } from "zod";

const MAX_NUMERO_DOCUMENTO = 9_999_999_999;
const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";
const UNKNOWN_FIELD = "body";

/**
 * Esquema Zod del cuerpo de la consulta Cliente 360.
 *
 * Aplica `.strict()` para rechazar claves inesperadas (Req 3.6) y valida en el
 * servidor el tipo, formato y rango de cada campo antes de invocar servicios
 * externos (Req 3.4, 3.5, 3.7).
 */
export const consultaSchema = z
  .object({
    tipoDocumento: z.literal("CC"),
    numeroDocumento: z.number().int().positive().max(MAX_NUMERO_DOCUMENTO),
  })
  .strict();

/** Cuerpo de entrada validado de la consulta Cliente 360. */
export type ConsultaInput = z.infer<typeof consultaSchema>;

/** Detalle de un fallo de validación con el campo o clave que lo originó. */
export interface ValidationFailure {
  readonly code: typeof VALIDATION_ERROR_CODE;
  readonly field: string;
}

/** Resultado discriminado de validar el cuerpo de una consulta. */
export type ValidationResult =
  | { readonly success: true; readonly data: ConsultaInput }
  | { readonly success: false; readonly error: ValidationFailure };

/**
 * Identifica el campo o clave inválida a partir del primer issue del ZodError.
 *
 * Para claves inesperadas (`unrecognized_keys`) usa el nombre de la clave; para
 * el resto usa la ruta del campo inválido.
 */
function resolveInvalidField(error: ZodError): string {
  const [firstIssue] = error.issues;

  if (firstIssue === undefined) {
    return UNKNOWN_FIELD;
  }

  if (firstIssue.code === "unrecognized_keys") {
    return firstIssue.keys[0] ?? UNKNOWN_FIELD;
  }

  return firstIssue.path.length > 0 ? String(firstIssue.path[0]) : UNKNOWN_FIELD;
}

/**
 * Valida el cuerpo de una consulta Cliente 360 sin lanzar excepciones.
 *
 * @param body cuerpo recibido en la solicitud, de tipo desconocido (Zero Trust).
 * @returns resultado discriminado; en fallo incluye `code = "VALIDATION_ERROR"`
 * y el `field` que señala el campo inválido o la clave no permitida (Req 3.4-3.7).
 */
export function validarConsulta(body: unknown): ValidationResult {
  const parsed = consultaSchema.safeParse(body);

  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    error: {
      code: VALIDATION_ERROR_CODE,
      field: resolveInvalidField(parsed.error),
    },
  };
}
