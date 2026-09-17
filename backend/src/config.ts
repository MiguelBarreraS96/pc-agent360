const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_JSON_BODY_LIMIT = "100kb";
const MAX_PORT = 65535;

const DEFAULT_CONECTA_SCOPE = "SrcServerCognitoConecta/ConectaApiScope";
const DEFAULT_CONECTA_TOKEN_TIMEOUT_MS = 5000;
const DEFAULT_CONECTA_GRAPHQL_TIMEOUT_MS = 15000;
const DEFAULT_CONECTA_TOKEN_REFRESH_MARGIN_MS = 60000;
const DEFAULT_CONECTA_BREAKER_FAILURE_THRESHOLD = 5;
const DEFAULT_CONECTA_BREAKER_RECOVERY_MS = 30000;

export interface ConectaConfig {
  readonly tokenUrl: string;
  readonly graphqlUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope: string;
  readonly xUserKey: string;
  readonly tokenTimeoutMs: number;
  readonly graphqlTimeoutMs: number;
  readonly tokenRefreshMarginMs: number;
  readonly breakerFailureThreshold: number;
  readonly breakerRecoveryMs: number;
}

export interface AppConfig {
  readonly conecta: ConectaConfig;
  readonly corsAllowedOrigins: ReadonlySet<string>;
  readonly host: string;
  readonly jsonBodyLimit: string;
  readonly port: number;
}

/** Parse a valid TCP port or return the secure local default. */
function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim() === "") {
    return DEFAULT_PORT;
  }

  const normalizedPort = rawPort.trim();
  if (!/^\d{1,5}$/.test(normalizedPort)) {
    throw new Error("Invalid PORT configuration.");
  }

  const port = Number(normalizedPort);
  if (port < 1 || port > MAX_PORT) {
    throw new Error("Invalid PORT configuration.");
  }

  return port;
}

/** Validate and normalize an explicitly authorized browser origin. */
function parseAllowedOrigin(rawOrigin: string): string {
  const normalizedOrigin = rawOrigin.trim().replace(/\/+$/, "");
  const parsedOrigin = new URL(normalizedOrigin);
  const isHttpProtocol = parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:";

  if (!isHttpProtocol || parsedOrigin.origin !== normalizedOrigin) {
    throw new Error("Invalid CORS_ALLOWED_ORIGINS configuration.");
  }

  return parsedOrigin.origin;
}

/** Convert the comma-separated CORS allowlist into normalized origins. */
function parseCorsAllowedOrigins(rawOrigins: string | undefined): ReadonlySet<string> {
  const origins = rawOrigins?.split(",") ?? [];
  const configuredOrigins = origins.filter((origin) => origin.trim() !== "");

  return new Set(configuredOrigins.map(parseAllowedOrigin));
}

/** Require a non-empty secret, naming the variable (never its value) when absent. */
function parseRequiredSecret(name: string, raw: string | undefined): string {
  const normalizedValue = raw?.trim() ?? "";
  if (normalizedValue === "") {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return normalizedValue;
}

/** Require an HTTPS URL, naming the variable (never its value) when invalid. */
function parseHttpsUrl(name: string, raw: string | undefined): string {
  const normalizedValue = parseRequiredSecret(name, raw);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    throw new Error(`Invalid ${name} configuration.`);
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`Invalid ${name} configuration.`);
  }

  return parsedUrl.toString();
}

/** Parse a positive integer environment value or fall back to the provided default. */
function parseNumberWithDefault(name: string, raw: string | undefined, fallback: number): number {
  const normalizedValue = raw?.trim() ?? "";
  if (normalizedValue === "") {
    return fallback;
  }

  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  const value = Number(normalizedValue);
  if (value < 1) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  return value;
}

/** Load and validate the Conecta DataOps configuration from environment variables. */
function parseConectaConfig(): ConectaConfig {
  return {
    tokenUrl: parseHttpsUrl("CONECTA_TOKEN_URL", process.env.CONECTA_TOKEN_URL),
    graphqlUrl: parseHttpsUrl("CONECTA_GRAPHQL_URL", process.env.CONECTA_GRAPHQL_URL),
    clientId: parseRequiredSecret("CONECTA_CLIENT_ID", process.env.CONECTA_CLIENT_ID),
    clientSecret: parseRequiredSecret("CONECTA_CLIENT_SECRET", process.env.CONECTA_CLIENT_SECRET),
    scope: process.env.CONECTA_SCOPE?.trim() || DEFAULT_CONECTA_SCOPE,
    xUserKey: parseRequiredSecret("CONECTA_X_USER_KEY", process.env.CONECTA_X_USER_KEY),
    tokenTimeoutMs: parseNumberWithDefault(
      "CONECTA_TOKEN_TIMEOUT_MS",
      process.env.CONECTA_TOKEN_TIMEOUT_MS,
      DEFAULT_CONECTA_TOKEN_TIMEOUT_MS,
    ),
    graphqlTimeoutMs: parseNumberWithDefault(
      "CONECTA_GRAPHQL_TIMEOUT_MS",
      process.env.CONECTA_GRAPHQL_TIMEOUT_MS,
      DEFAULT_CONECTA_GRAPHQL_TIMEOUT_MS,
    ),
    tokenRefreshMarginMs: parseNumberWithDefault(
      "CONECTA_TOKEN_REFRESH_MARGIN_MS",
      process.env.CONECTA_TOKEN_REFRESH_MARGIN_MS,
      DEFAULT_CONECTA_TOKEN_REFRESH_MARGIN_MS,
    ),
    breakerFailureThreshold: parseNumberWithDefault(
      "CONECTA_BREAKER_FAILURE_THRESHOLD",
      process.env.CONECTA_BREAKER_FAILURE_THRESHOLD,
      DEFAULT_CONECTA_BREAKER_FAILURE_THRESHOLD,
    ),
    breakerRecoveryMs: parseNumberWithDefault(
      "CONECTA_BREAKER_RECOVERY_MS",
      process.env.CONECTA_BREAKER_RECOVERY_MS,
      DEFAULT_CONECTA_BREAKER_RECOVERY_MS,
    ),
  };
}

/** Load and validate the service configuration from environment variables. */
function loadConfig(): AppConfig {
  const host = process.env.HOST?.trim() || DEFAULT_HOST;

  return Object.freeze({
    conecta: Object.freeze(parseConectaConfig()),
    corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
    host,
    jsonBodyLimit: DEFAULT_JSON_BODY_LIMIT,
    port: parsePort(process.env.PORT),
  });
}

export const appConfig = loadConfig();
