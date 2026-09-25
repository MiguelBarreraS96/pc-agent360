export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED"
  | "UNPROCESSABLE_ENTITY";

type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

/** Represent a safe client-facing failure without retaining sensitive cause details. */
export class ApiError extends Error {
  public constructor(
    public readonly status: ApiErrorStatus,
    public readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

/** Identify errors intentionally safe for the generic HTTP error mapper. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Create a generic validation failure. */
export function badRequest(): ApiError {
  return new ApiError(400, "BAD_REQUEST");
}

/** Create a generic conflicting-state failure. */
export function conflict(): ApiError {
  return new ApiError(409, "CONFLICT");
}

/** Create a generic authorization failure. */
export function forbidden(): ApiError {
  return new ApiError(403, "FORBIDDEN");
}

/** Create a generic resource-not-found failure. */
export function notFound(): ApiError {
  return new ApiError(404, "NOT_FOUND");
}

/** Create a generic rate-limit failure. */
export function rateLimited(): ApiError {
  return new ApiError(429, "RATE_LIMITED");
}

/** Create a failure for a well-formed request whose semantics cannot be processed (e.g. a report range too large). */
export function unprocessableEntity(): ApiError {
  return new ApiError(422, "UNPROCESSABLE_ENTITY");
}

/** Create a generic authentication failure. */
export function unauthenticated(): ApiError {
  return new ApiError(401, "UNAUTHENTICATED");
}
