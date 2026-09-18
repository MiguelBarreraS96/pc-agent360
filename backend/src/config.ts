const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_FIRESTORE_DATABASE_ID = "(default)";
const DEFAULT_GEMINI_LOCATION = "us-central1";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 900;
const DEFAULT_CONECTA_SCOPE = "SrcServerCognitoConecta/ConectaApiScope";
const DEFAULT_CONECTA_TOKEN_TIMEOUT_MS = 5000;
const DEFAULT_CONECTA_GRAPHQL_TIMEOUT_MS = 15000;
const DEFAULT_CONECTA_TOKEN_REFRESH_MARGIN_MS = 60000;
const DEFAULT_CONECTA_BREAKER_FAILURE_THRESHOLD = 5;
const DEFAULT_CONECTA_BREAKER_RECOVERY_MS = 30000;
const MAX_PORT = 65_535;
const MAX_INACTIVITY_TIMEOUT_SECONDS = 3_600;
const MIN_INACTIVITY_TIMEOUT_SECONDS = 60;
const ALLOWED_CONECTA_HOSTS = new Set(["api-conecta.segurosbolivar.com"]);

export type CookieSameSite = "lax" | "none" | "strict";
export type RuntimeEnvironment = "development" | "production" | "test";

export interface AppConfig {
  readonly conecta: ConectaConfig;
  readonly corsAllowedOrigins: ReadonlySet<string>;
  readonly firebaseProjectId: string | undefined;
  readonly firestore: FirestoreConfig;
  readonly gemini: GeminiConfig;
  readonly host: string;
  readonly isProduction: boolean;
  readonly jsonBodyLimit: "100kb";
  readonly port: number;
  readonly rag: RagConfig;
  readonly session: SessionConfig;
}

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

export interface FirestoreConfig {
  readonly databaseId: string;
}

export interface GeminiConfig {
  readonly location: string;
  readonly model: string;
}

export interface RagConfig {
  readonly bucketLocation: string;
  readonly bucketName: string;
  readonly discoveryEngineLocation: string;
}

export interface SessionConfig {
  readonly cookieName: string;
  readonly cookieSameSite: CookieSameSite;
  readonly cookieSecure: boolean;
  readonly inactivityTimeoutMilliseconds: number;
}

/** Parse a bounded positive integer from environment configuration. */
function parseBoundedInteger(
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  variableName: string,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`Invalid ${variableName} configuration.`);
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new Error(`Invalid ${variableName} configuration.`);
  }

  return parsedValue;
}

/** Validate and normalize an explicitly authorized browser origin. */
function parseAllowedOrigin(rawOrigin: string, isProduction: boolean): string {
  const normalizedOrigin = rawOrigin.trim().replace(/\/+$/, "");
  const parsedOrigin = new URL(normalizedOrigin);
  const isAllowedProtocol = parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:";

  if (!isAllowedProtocol || parsedOrigin.origin !== normalizedOrigin) {
    throw new Error("Invalid CORS_ALLOWED_ORIGINS configuration.");
  }

  if (isProduction && parsedOrigin.protocol !== "https:") {
    throw new Error("Invalid CORS_ALLOWED_ORIGINS configuration.");
  }

  return parsedOrigin.origin;
}

/** Convert the comma-separated CORS allowlist into normalized exact origins. */
function parseCorsAllowedOrigins(rawOrigins: string | undefined, isProduction: boolean): ReadonlySet<string> {
  const configuredOrigins = (rawOrigins?.split(",") ?? []).filter((origin) => origin.trim() !== "");
  const origins = new Set(configuredOrigins.map((origin) => parseAllowedOrigin(origin, isProduction)));

  if (isProduction && origins.size === 0) {
    throw new Error("Invalid CORS_ALLOWED_ORIGINS configuration.");
  }

  return origins;
}

/** Parse the runtime environment from its small allowlist. */
function parseEnvironment(rawEnvironment: string | undefined): RuntimeEnvironment {
  const environment = rawEnvironment?.trim() || "development";
  if (environment === "development" || environment === "production" || environment === "test") {
    return environment;
  }

  throw new Error("Invalid NODE_ENV configuration.");
}

/** Validate the Firestore database identifier, defaulting to the project's default database. */
function parseFirestoreDatabaseId(rawDatabaseId: string | undefined): string {
  const databaseId = rawDatabaseId?.trim() || DEFAULT_FIRESTORE_DATABASE_ID;
  if (!/^(\(default\)|[a-z0-9][a-z0-9-]{2,61}[a-z0-9])$/.test(databaseId)) {
    throw new Error("Invalid FIRESTORE_DATABASE_ID configuration.");
  }

  return databaseId;
}

/** Validate a cookie name so it cannot alter the response header syntax. */
function parseCookieName(rawCookieName: string | undefined): string {
  const cookieName = rawCookieName?.trim() || "agent360_session";
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(cookieName)) {
    throw new Error("Invalid SESSION_COOKIE_NAME configuration.");
  }

  return cookieName;
}

/** Parse the limited SameSite values supported by the session cookie. */
function parseCookieSameSite(rawSameSite: string | undefined): CookieSameSite {
  const sameSite = rawSameSite?.trim().toLowerCase() || "lax";
  if (sameSite === "lax" || sameSite === "none" || sameSite === "strict") {
    return sameSite;
  }

  throw new Error("Invalid SESSION_COOKIE_SAME_SITE configuration.");
}

/** Validate an optional Firebase project identifier without requiring a key file. */
function parseFirebaseProjectId(rawProjectId: string | undefined): string | undefined {
  const projectId = rawProjectId?.trim();
  if (projectId === undefined || projectId === "") {
    return undefined;
  }

  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("Invalid FIREBASE_PROJECT_ID configuration.");
  }

  return projectId;
}

/** Validate the required Cloud Storage bucket name that stores every product's source documents. */
function parseGcsBucketName(rawBucketName: string | undefined): string {
  const bucketName = rawBucketName?.trim();
  if (bucketName === undefined || bucketName === "") {
    throw new Error("Invalid RAG_BUCKET_NAME configuration.");
  }

  if (!/^[a-z0-9][a-z0-9-_.]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error("Invalid RAG_BUCKET_NAME configuration.");
  }

  return bucketName;
}

/** Validate the Cloud Storage location used only if the RAG bucket has to be created. */
function parseGcsBucketLocation(rawLocation: string | undefined): string {
  const location = rawLocation?.trim() || "US";
  if (!/^[A-Za-z0-9-]{2,30}$/.test(location)) {
    throw new Error("Invalid RAG_BUCKET_LOCATION configuration.");
  }

  return location.toUpperCase();
}

/** Validate the Discovery Engine location from its small allowlist. */
function parseDiscoveryEngineLocation(rawLocation: string | undefined): string {
  const location = rawLocation?.trim().toLowerCase() || "global";
  if (location !== "global" && location !== "us" && location !== "eu") {
    throw new Error("Invalid DISCOVERY_ENGINE_LOCATION configuration.");
  }

  return location;
}

/** Validate the Vertex AI Gemini model identifier used to answer grounded chat questions. */
function parseGeminiModel(rawModel: string | undefined): string {
  const model = rawModel?.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[a-z0-9][a-z0-9.-]{1,78}[a-z0-9]$/.test(model)) {
    throw new Error("Invalid GEMINI_MODEL configuration.");
  }

  return model;
}

/** Validate the Vertex AI region used for Gemini generateContent calls; unlike Discovery Engine, "global" is not supported. */
function parseGeminiLocation(rawLocation: string | undefined): string {
  const location = rawLocation?.trim() || DEFAULT_GEMINI_LOCATION;
  if (location === "global" || !/^[a-z0-9-]{2,30}$/.test(location)) {
    throw new Error("Invalid GEMINI_LOCATION configuration.");
  }

  return location;
}

/** Require a non-empty secret, naming the variable but never exposing its value. */
function parseRequiredSecret(name: string, rawValue: string | undefined): string {
  const normalizedValue = rawValue?.trim() ?? "";
  if (normalizedValue === "") {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return normalizedValue;
}

/** Validate an allowed HTTPS endpoint for the Conecta external integration. */
function parseConectaHttpsUrl(name: string, rawValue: string | undefined): string {
  const normalizedValue = parseRequiredSecret(name, rawValue);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    throw new Error(`Invalid ${name} configuration.`);
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    !ALLOWED_CONECTA_HOSTS.has(parsedUrl.hostname)
  ) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  return parsedUrl.toString();
}

/** Parse a bounded positive integration setting or use its documented default. */
function parseNumberWithDefault(name: string, rawValue: string | undefined, fallback: number): number {
  const normalizedValue = rawValue?.trim() ?? "";
  if (normalizedValue === "") {
    return fallback;
  }

  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  const value = Number(normalizedValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} configuration.`);
  }

  return value;
}

/** Load and validate the Conecta DataOps configuration from environment variables. */
function parseConectaConfig(): ConectaConfig {
  return {
    tokenUrl: parseConectaHttpsUrl("CONECTA_TOKEN_URL", process.env.CONECTA_TOKEN_URL),
    graphqlUrl: parseConectaHttpsUrl("CONECTA_GRAPHQL_URL", process.env.CONECTA_GRAPHQL_URL),
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

/** Load immutable, validated service configuration from environment variables. */
function loadConfig(): AppConfig {
  const environment = parseEnvironment(process.env.NODE_ENV);
  const isProduction = environment === "production";
  const cookieSameSite = parseCookieSameSite(process.env.SESSION_COOKIE_SAME_SITE);
  const cookieSecure = isProduction;

  if (cookieSameSite === "none" && !cookieSecure) {
    throw new Error("Invalid SESSION_COOKIE_SAME_SITE configuration.");
  }

  return Object.freeze({
    conecta: Object.freeze(parseConectaConfig()),
    corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS, isProduction),
    firebaseProjectId: parseFirebaseProjectId(process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT),
    firestore: Object.freeze({
      databaseId: parseFirestoreDatabaseId(process.env.FIRESTORE_DATABASE_ID),
    }),
    gemini: Object.freeze({
      location: parseGeminiLocation(process.env.GEMINI_LOCATION),
      model: parseGeminiModel(process.env.GEMINI_MODEL),
    }),
    host: process.env.HOST?.trim() || DEFAULT_HOST,
    isProduction,
    jsonBodyLimit: "100kb",
    port: parseBoundedInteger(process.env.PORT, DEFAULT_PORT, 1, MAX_PORT, "PORT"),
    rag: Object.freeze({
      bucketLocation: parseGcsBucketLocation(process.env.RAG_BUCKET_LOCATION),
      bucketName: parseGcsBucketName(process.env.RAG_BUCKET_NAME),
      discoveryEngineLocation: parseDiscoveryEngineLocation(process.env.DISCOVERY_ENGINE_LOCATION),
    }),
    session: Object.freeze({
      cookieName: parseCookieName(process.env.SESSION_COOKIE_NAME),
      cookieSameSite,
      cookieSecure,
      inactivityTimeoutMilliseconds:
        parseBoundedInteger(
          process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS,
          DEFAULT_INACTIVITY_TIMEOUT_SECONDS,
          MIN_INACTIVITY_TIMEOUT_SECONDS,
          MAX_INACTIVITY_TIMEOUT_SECONDS,
          "SESSION_INACTIVITY_TIMEOUT_SECONDS",
        ) * 1_000,
    }),
  });
}

export const appConfig = loadConfig();
