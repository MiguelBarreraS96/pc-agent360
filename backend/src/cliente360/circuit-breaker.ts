import { appConfig } from "../config";

/** Código controlado que identifica el rechazo por breaker abierto (Req 7.4). */
export const CIRCUIT_OPEN_CODE = "CIRCUIT_OPEN";

/** Estados de la máquina del circuit breaker (Req 7.4, 7.5). */
type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Opciones de construcción del circuit breaker. */
export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly recoveryMs: number;
}

/**
 * Error controlado que se lanza cuando el breaker está abierto.
 *
 * Es identificable por su propiedad `code = "CIRCUIT_OPEN"` para que la
 * orquestación lo mapee a `503` sin exponer detalles internos (Req 7.4).
 */
export class CircuitOpenError extends Error {
  readonly code: typeof CIRCUIT_OPEN_CODE = CIRCUIT_OPEN_CODE;

  constructor() {
    super("El servicio no está disponible temporalmente.");
    this.name = "CircuitOpenError";
  }
}

/** Determina si un error es un rechazo controlado por breaker abierto. */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError;
}

/**
 * Circuit breaker con máquina de estados closed/open/half-open (Req 7.4, 7.5).
 *
 * - `CLOSED`: cuenta fallos consecutivos; un éxito resetea el contador; al
 *   alcanzar el umbral transiciona a `OPEN`.
 * - `OPEN`: rechaza de inmediato con `CircuitOpenError` sin invocar el servicio;
 *   una vez transcurrido `recoveryMs`, el siguiente intento pasa a `HALF_OPEN`.
 * - `HALF_OPEN`: permite exactamente una solicitud de prueba; el éxito cierra el
 *   breaker (resetea), el fallo lo abre de nuevo por otros `recoveryMs`.
 *
 * El tiempo se mide con `Date.now()` y se evalúa al momento de cada intento; no
 * usa temporizadores en segundo plano.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly recoveryMs: number;

  private state: BreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAtMs = 0;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.recoveryMs = options.recoveryMs;
  }

  /**
   * Ejecuta la operación protegida aplicando la política del breaker.
   *
   * @param fn operación asíncrona a proteger (p. ej. la llamada GraphQL).
   * @returns el resultado de `fn` cuando se permite y tiene éxito.
   * @throws {CircuitOpenError} cuando el breaker está abierto y aún no expira la
   * ventana de recuperación, sin invocar `fn` (Req 7.4).
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canAttempt()) {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Evalúa si se permite un intento y aplica la transición OPEN → HALF_OPEN. */
  private canAttempt(): boolean {
    if (this.state !== "OPEN") {
      return true;
    }

    const elapsedMs = Date.now() - this.openedAtMs;
    if (elapsedMs >= this.recoveryMs) {
      this.state = "HALF_OPEN";
      return true;
    }

    return false;
  }

  /** Cierra el breaker y resetea el contador tras una operación exitosa. */
  private onSuccess(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
  }

  /** Abre el breaker en HALF_OPEN o al alcanzar el umbral de fallos. */
  private onFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.open();
    }
  }

  /** Transiciona a OPEN y registra el instante de apertura. */
  private open(): void {
    this.state = "OPEN";
    this.openedAtMs = Date.now();
  }
}

/**
 * Crea un circuit breaker con los valores por defecto de la configuración de
 * Conecta (`breakerFailureThreshold`, `breakerRecoveryMs`).
 */
export function createConectaCircuitBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: appConfig.conecta.breakerFailureThreshold,
    recoveryMs: appConfig.conecta.breakerRecoveryMs,
  });
}
