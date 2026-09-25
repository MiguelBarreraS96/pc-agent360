import type { ConectaClienteData, ConsultaInput } from "./conecta-types";

// Variable names must start with "mock" so ts-jest/babel-jest-hoist allows referencing them
// from the (hoisted) jest.mock factories below.
const mockAppConfig = {
  conecta: {
    graphqlUrl: "https://api-conecta.segurosbolivar.com/prod/dataops/graphql/cliente",
    xUserKey: "test-user-key",
    graphqlTimeoutMs: 50,
    graphqlTotalBudgetMs: 5000,
  },
};

jest.mock("../config", () => ({ appConfig: mockAppConfig }));
jest.mock("../logger", () => ({ logEvent: jest.fn() }));
jest.mock("./token-service", () => {
  const actual = jest.requireActual("./token-service");
  return {
    ...actual,
    tokenService: {
      getToken: jest.fn(),
      invalidate: jest.fn(),
    },
  };
});

import { AuthUpstreamError, tokenService } from "./token-service";
import { ConfigMissingError, UpstreamError, UpstreamTimeoutError, graphqlClient } from "./graphql-client";

const mockedGetToken = tokenService.getToken as jest.Mock;
const mockedInvalidate = tokenService.invalidate as jest.Mock;

const INPUT: ConsultaInput = { tipoDocumento: "CC", numeroDocumento: 1012345678 };
const CORRELATION_ID = "test-correlation";

/** Minimal `Response`-shaped object for a successful GraphQL reply. */
function okResponse(cliente: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { cliente } }),
  } as Response;
}

/** Minimal `Response`-shaped object for a non-ok HTTP status (401, 503, 400, ...). */
function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}

/** A `200 OK` response whose GraphQL body carries `errors` (not a transport failure). */
function graphqlErrorsResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ errors: [{ message: "boom" }] }),
  } as Response;
}

/** Queues one `fetch` call that hangs until the caller's `AbortController` fires, like a real timeout. */
function mockFetchOnceHanging(): void {
  (global.fetch as jest.Mock).mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      }),
  );
}

/** Queues one `fetch` call that rejects immediately, like a DNS/connection failure. */
function mockFetchOnceNetworkError(): void {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("fetch failed"));
}

describe("graphqlClient.consultarCliente retry behavior", () => {
  beforeEach(() => {
    mockAppConfig.conecta.xUserKey = "test-user-key";
    mockAppConfig.conecta.graphqlTimeoutMs = 50;
    mockAppConfig.conecta.graphqlTotalBudgetMs = 5000;

    global.fetch = jest.fn();
    mockedGetToken.mockReset();
    mockedInvalidate.mockReset();
    mockedGetToken.mockResolvedValue("token-1");
  });

  it("retries once after a timeout and then succeeds", async () => {
    mockFetchOnceHanging();
    (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse({ nombreCompleto: "ANA" }));

    const result = await graphqlClient.consultarCliente(INPUT, CORRELATION_ID);

    expect((result as ConectaClienteData | null)?.nombreCompleto).toBe("ANA");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 503 and then succeeds", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(okResponse({ nombreCompleto: "ANA" }));

    const result = await graphqlClient.consultarCliente(INPUT, CORRELATION_ID);

    expect((result as ConectaClienteData | null)?.nombreCompleto).toBe("ANA");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network error and then succeeds", async () => {
    mockFetchOnceNetworkError();
    (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse({ nombreCompleto: "ANA" }));

    const result = await graphqlClient.consultarCliente(INPUT, CORRELATION_ID);

    expect((result as ConectaClienteData | null)?.nombreCompleto).toBe("ANA");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws UpstreamTimeoutError after two consecutive timeouts", async () => {
    mockFetchOnceHanging();
    mockFetchOnceHanging();

    await expect(graphqlClient.consultarCliente(INPUT, CORRELATION_ID)).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the GraphQL response body carries errors", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(graphqlErrorsResponse());

    const failure = graphqlClient.consultarCliente(INPUT, CORRELATION_ID);
    await expect(failure).rejects.toBeInstanceOf(UpstreamError);
    await expect(failure).rejects.toMatchObject({ retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a non-5xx, non-401 status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(statusResponse(400));

    const failure = graphqlClient.consultarCliente(INPUT, CORRELATION_ID);
    await expect(failure).rejects.toBeInstanceOf(UpstreamError);
    await expect(failure).rejects.toMatchObject({ status: 400, retryable: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the transient retry once the remaining budget is too small", async () => {
    mockAppConfig.conecta.graphqlTimeoutMs = 20;
    mockAppConfig.conecta.graphqlTotalBudgetMs = 20;
    mockFetchOnceHanging();

    await expect(graphqlClient.consultarCliente(INPUT, CORRELATION_ID)).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("still invalidates the token and retries once on a single 401 (unrelated to the transient retry)", async () => {
    mockedGetToken.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(statusResponse(401))
      .mockResolvedValueOnce(okResponse({ nombreCompleto: "ANA" }));

    const result = await graphqlClient.consultarCliente(INPUT, CORRELATION_ID);

    expect((result as ConectaClienteData | null)?.nombreCompleto).toBe("ANA");
    expect(mockedInvalidate).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws AuthUpstreamError after a second consecutive 401 without a transient retry", async () => {
    mockedGetToken.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
    (global.fetch as jest.Mock).mockResolvedValue(statusResponse(401));

    await expect(graphqlClient.consultarCliente(INPUT, CORRELATION_ID)).rejects.toBeInstanceOf(AuthUpstreamError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws ConfigMissingError without calling fetch when x-user-key is blank", async () => {
    mockAppConfig.conecta.xUserKey = "   ";

    await expect(graphqlClient.consultarCliente(INPUT, CORRELATION_ID)).rejects.toBeInstanceOf(ConfigMissingError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
