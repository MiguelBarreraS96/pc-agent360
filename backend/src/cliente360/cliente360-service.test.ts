import type { ConsultaInput } from "./conecta-types";

// The breaker reads its thresholds from appConfig at module load time (createConectaCircuitBreaker()).
const mockAppConfig = {
  conecta: {
    breakerFailureThreshold: 2,
    breakerRecoveryMs: 30_000,
  },
};

jest.mock("../config", () => ({ appConfig: mockAppConfig }));
jest.mock("../logger", () => ({ logEvent: jest.fn() }));

const mockConsultarCliente = jest.fn();
jest.mock("./graphql-client", () => {
  const actual = jest.requireActual("./graphql-client");
  return {
    ...actual,
    graphqlClient: { consultarCliente: (...args: unknown[]) => mockConsultarCliente(...args) },
  };
});

import { UpstreamTimeoutError } from "./graphql-client";
import { cliente360Service } from "./cliente360-service";

const INPUT: ConsultaInput = { tipoDocumento: "CC", numeroDocumento: 1012345678 };

describe("cliente360Service circuit breaker integration", () => {
  // The breaker is a module-level singleton (shared across every call in this suite), so
  // the whole state machine is exercised as a single ordered scenario rather than
  // independent tests, which would otherwise interfere with each other's failure count.
  it("counts only the final outcome of each call, and 'not found' never counts as a failure", async () => {
    // A "not found" result is a success for the breaker: the counter starts and stays at 0.
    mockConsultarCliente.mockResolvedValueOnce(null);
    await expect(cliente360Service.consultarCliente(INPUT, "corr-1")).resolves.toEqual({ found: false });

    // One transient failure (as graphql-client throws it after exhausting its own internal
    // retry) counts as exactly one failure for the breaker, not one per attempt.
    mockConsultarCliente.mockRejectedValueOnce(new UpstreamTimeoutError("timeout"));
    await expect(cliente360Service.consultarCliente(INPUT, "corr-2")).rejects.toBeInstanceOf(UpstreamTimeoutError);

    // A success in between resets the consecutive-failure counter back to 0.
    mockConsultarCliente.mockResolvedValueOnce(null);
    await expect(cliente360Service.consultarCliente(INPUT, "corr-3")).resolves.toEqual({ found: false });

    // Two consecutive failures now reach the configured threshold (2) and open the breaker.
    mockConsultarCliente.mockRejectedValueOnce(new UpstreamTimeoutError("timeout"));
    mockConsultarCliente.mockRejectedValueOnce(new UpstreamTimeoutError("timeout"));
    await expect(cliente360Service.consultarCliente(INPUT, "corr-4")).rejects.toBeInstanceOf(UpstreamTimeoutError);
    await expect(cliente360Service.consultarCliente(INPUT, "corr-5")).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(mockConsultarCliente).toHaveBeenCalledTimes(5);

    // The breaker is now open: it rejects immediately without invoking graphqlClient again.
    await expect(cliente360Service.consultarCliente(INPUT, "corr-6")).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(mockConsultarCliente).toHaveBeenCalledTimes(5);
  });
});
