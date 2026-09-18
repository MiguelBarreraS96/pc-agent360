import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (request: Request, response: Response) => Promise<void>;

/** Forward rejected asynchronous route work to the centralized generic error handler. */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
}
