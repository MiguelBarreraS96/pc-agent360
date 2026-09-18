import type { Request, RequestHandler } from "express";

import { rateLimited } from "../errors";

const MAX_TRACKED_CLIENTS = 10_000;
const MINIMUM_WINDOW_MILLISECONDS = 1_000;

interface RateLimitEntry {
  readonly requestCount: number;
  readonly resetAt: number;
}

export interface RateLimitOptions {
  readonly maxRequests: number;
  readonly windowMilliseconds: number;
}

/** Build an in-memory, bounded IP rate limiter for a low-volume application endpoint. */
export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  assertValidOptions(options);

  const entries = new Map<string, RateLimitEntry>();
  let lastPruneAt = 0;

  return (request, response, next): void => {
    const now = Date.now();
    pruneExpiredEntries(entries, now, lastPruneAt, options.windowMilliseconds);
    lastPruneAt = now;

    const clientKey = resolveClientKey(request);
    const currentEntry = entries.get(clientKey);
    if (currentEntry === undefined || currentEntry.resetAt <= now) {
      if (entries.size >= MAX_TRACKED_CLIENTS) {
        response.setHeader("Retry-After", "60");
        next(rateLimited());
        return;
      }

      entries.set(clientKey, { requestCount: 1, resetAt: now + options.windowMilliseconds });
      next();
      return;
    }

    if (currentEntry.requestCount >= options.maxRequests) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((currentEntry.resetAt - now) / 1_000))));
      next(rateLimited());
      return;
    }

    entries.set(clientKey, {
      requestCount: currentEntry.requestCount + 1,
      resetAt: currentEntry.resetAt,
    });
    next();
  };
}

/** Reject configuration that would allow an unbounded or unusable limiter. */
function assertValidOptions(options: RateLimitOptions): void {
  if (
    !Number.isSafeInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    !Number.isSafeInteger(options.windowMilliseconds) ||
    options.windowMilliseconds < MINIMUM_WINDOW_MILLISECONDS
  ) {
    throw new Error("Invalid rate-limit configuration.");
  }
}

/** Derive a bounded server-observed client key without trusting client-controlled request headers. */
function resolveClientKey(request: Request): string {
  const clientIp = request.ip?.trim() ?? "";
  return clientIp.length > 0 && clientIp.length <= 128 ? clientIp : "unknown";
}

/** Remove expired keys before the map can accumulate unbounded client state. */
function pruneExpiredEntries(
  entries: Map<string, RateLimitEntry>,
  now: number,
  lastPruneAt: number,
  windowMilliseconds: number,
): void {
  if (now - lastPruneAt < windowMilliseconds && entries.size < MAX_TRACKED_CLIENTS) {
    return;
  }

  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key);
    }
  }
}
