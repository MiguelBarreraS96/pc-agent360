const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_JSON_BODY_LIMIT = "100kb";
const MAX_PORT = 65535;

export interface AppConfig {
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

/** Load and validate the service configuration from environment variables. */
function loadConfig(): AppConfig {
  const host = process.env.HOST?.trim() || DEFAULT_HOST;

  return Object.freeze({
    corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
    host,
    jsonBodyLimit: DEFAULT_JSON_BODY_LIMIT,
    port: parsePort(process.env.PORT),
  });
}

export const appConfig = loadConfig();
