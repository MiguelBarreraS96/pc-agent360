import cors, { type CorsOptions } from "cors";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";

import { appConfig } from "./config";
import { correlationIdMiddleware } from "./middleware/correlation-id";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

interface HealthResponse {
  readonly correlationId: string;
  readonly service: "pc-agent360-backend";
  readonly status: "UP";
}

/** Build restrictive CORS settings from the explicit environment allowlist. */
function createCorsOptions(allowedOrigins: ReadonlySet<string>): CorsOptions {
  return {
    allowedHeaders: ["Content-Type", "X-Correlation-ID"],
    exposedHeaders: ["X-Correlation-ID"],
    maxAge: 600,
    methods: ["GET"],
    optionsSuccessStatus: 204,
    origin(origin, callback): void {
      const isAllowed = origin === undefined || allowedOrigins.has(origin);
      callback(null, isAllowed);
    },
  };
}

/** Return the minimal, non-sensitive service health representation. */
const healthHandler: RequestHandler = (request, response): void => {
  response.status(200).json({
    correlationId: request.correlationId,
    service: "pc-agent360-backend",
    status: "UP",
  } satisfies HealthResponse);
};

/** Create the HTTP application with security, tracing, routing, and error handling. */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(correlationIdMiddleware);
  app.use(helmet());
  app.use(cors(createCorsOptions(appConfig.corsAllowedOrigins)));
  app.use(express.json({ limit: appConfig.jsonBodyLimit, strict: true }));
  app.get("/api/v1/health", healthHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
