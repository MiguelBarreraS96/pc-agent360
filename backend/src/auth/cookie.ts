import type { Request, Response } from "express";

import type { SessionConfig } from "../config";

const SESSION_COOKIE_PATH = "/";

/** Set the opaque session secret using only browser-inaccessible cookie attributes. */
export function setSessionCookie(response: Response, sessionSecret: string, config: SessionConfig): void {
  response.cookie(config.cookieName, sessionSecret, {
    httpOnly: true,
    maxAge: 3_600_000,
    path: SESSION_COOKIE_PATH,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  });
}

/** Expire the session cookie with the same scope and security attributes used to set it. */
export function clearSessionCookie(response: Response, config: SessionConfig): void {
  response.clearCookie(config.cookieName, {
    httpOnly: true,
    path: SESSION_COOKIE_PATH,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  });
}

/** Read one cookie value without deserializing or trusting any other request cookies. */
export function readCookie(request: Request, cookieName: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();
    if (name === cookieName) {
      return segment.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}
