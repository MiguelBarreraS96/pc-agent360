const MAX_RAG_ERROR_MESSAGE_LENGTH = 500;
const SENSITIVE_ERROR_VALUE_PATTERN = /(?:bearer\s+|(?:api[_-]?key|authorization|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi;

export type RagFailureReason =
  | "DATASTORE_CREATE_FAILED"
  | "DELETE_FAILED"
  | "ENGINE_CREATE_FAILED"
  | "IMPORT_FAILED"
  | "SEARCH_FAILED"
  | "UNKNOWN";

export interface RagFailureLogDetails {
  readonly externalErrorCode: string;
  readonly externalErrorMessage: string;
  readonly externalErrorName: string;
  readonly ragFailureReason: RagFailureReason;
}

/** Wrap a Discovery Engine or Cloud Storage failure without exposing raw GCP details to API clients. */
export class RagOperationError extends Error {
  public constructor(
    public readonly reason: RagFailureReason,
    public override readonly cause?: unknown,
  ) {
    super(reason);
    this.name = "RagOperationError";
  }
}

/** Identify the gRPC "already exists" status Discovery Engine returns for a repeated create. */
export function isAlreadyExists(error: unknown): boolean {
  return hasErrorCode(error, 6);
}

/** Identify the "not found" status Discovery Engine (gRPC) and Cloud Storage (HTTP) return for missing resources. */
export function isNotFound(error: unknown): boolean {
  return hasErrorCode(error, 5) || hasErrorCode(error, 404);
}

/** Produce bounded, redacted external-error fields suitable for structured operational logs. */
export function toRagFailureLogDetails(error: unknown): RagFailureLogDetails {
  const sourceError = error instanceof RagOperationError ? error.cause : error;

  return {
    externalErrorCode: readErrorCode(sourceError),
    externalErrorMessage: readErrorMessage(sourceError),
    externalErrorName: readErrorName(sourceError),
    ragFailureReason: error instanceof RagOperationError ? error.reason : "UNKNOWN",
  };
}

function hasErrorCode(error: unknown, code: number): boolean {
  return isRecord(error) && error.code === code;
}

/** Extract a stable provider error code without serializing the full provider response. */
function readErrorCode(error: unknown): string {
  if (!isRecord(error)) {
    return "UNKNOWN";
  }

  const code = error.code;
  return typeof code === "number" || typeof code === "string" ? String(code) : "UNKNOWN";
}

/** Extract a safe error message, removing credential-like values and bounding its size. */
function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : isRecord(error) ? error.message : error;
  if (typeof message !== "string") {
    return "No external error message provided.";
  }

  const sanitizedMessage = message
    .replace(SENSITIVE_ERROR_VALUE_PATTERN, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RAG_ERROR_MESSAGE_LENGTH);

  return sanitizedMessage === "" ? "No external error message provided." : sanitizedMessage;
}

/** Extract the provider error class without serializing arbitrary error objects. */
function readErrorName(error: unknown): string {
  if (error instanceof Error && error.name !== "") {
    return error.name;
  }

  return isRecord(error) && typeof error.name === "string" && error.name !== "" ? error.name : "UnknownError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
