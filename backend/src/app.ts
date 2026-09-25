import cors, { type CorsOptions } from "cors";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";

import { createAgentRouter } from "./agent/agent.router";
import { createRolesRouter } from "./access/roles.router";
import { createUsersRouter } from "./access/users.router";
import { createAuthRouter } from "./auth/auth.router";
import { createChatRouter } from "./chat/chat.router";
import { createGeminiPreviewRouter } from "./chat/gemini-preview.router";
import { CLIENTE360_CONSULTA_PATH, cliente360Router } from "./cliente360/cliente360-router";
import type { ApplicationDependencies } from "./composition";
import { forbidden } from "./errors";
import { correlationIdMiddleware } from "./middleware/correlation-id";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { createProductsRouter } from "./products/products.router";
import { createReportsRouter } from "./reports/reports.router";

interface HealthResponse {
  readonly correlationId: string;
  readonly service: "pc-agent360-backend";
  readonly status: "UP";
}

/** Build credentialed CORS settings from the exact configured browser-origin allowlist. */
function createCorsOptions(allowedOrigins: ReadonlySet<string>): CorsOptions {
  return {
    allowedHeaders: ["Authorization", "Content-Type", "X-Correlation-ID", "X-CSRF-Token"],
    credentials: true,
    exposedHeaders: ["Content-Disposition", "Retry-After", "X-Correlation-ID"],
    maxAge: 600,
    methods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST"],
    optionsSuccessStatus: 204,
    origin(origin, callback): void {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(forbidden());
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

/** Create the HTTP application with security, tracing, authentication, and centralized errors. */
export function createApp(dependencies: ApplicationDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  if (dependencies.config.isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(correlationIdMiddleware);
  app.use(helmet());
  app.use(cors(createCorsOptions(dependencies.config.corsAllowedOrigins)));
  app.use(express.json({ limit: dependencies.config.jsonBodyLimit, strict: true }));

  app.use(
    "/api/v1/auth",
    createAuthRouter({
      authenticate: dependencies.authenticate,
      authService: dependencies.authService,
      corsAllowedOrigins: dependencies.config.corsAllowedOrigins,
      rateLimitAuthentication: dependencies.rateLimitAuthentication,
      rateLimitSession: dependencies.rateLimitSession,
      requireCsrf: dependencies.requireCsrf,
      sessionConfig: dependencies.config.session,
    }),
  );
  app.use(
    "/api/v1/admin/users",
    createUsersRouter({
      authenticate: dependencies.authenticate,
      requireAdmin: dependencies.requireAdmin,
      requireCsrf: dependencies.requireCsrf,
      requireUsersRead: dependencies.requireUsersRead,
      requireUsersWrite: dependencies.requireUsersWrite,
      userService: dependencies.userService,
    }),
  );
  app.use(
    "/api/v1/admin/roles",
    createRolesRouter({
      authenticate: dependencies.authenticate,
      requireAdmin: dependencies.requireAdmin,
      requireCsrf: dependencies.requireCsrf,
      requireRolesRead: dependencies.requireRolesRead,
      requireRolesWrite: dependencies.requireRolesWrite,
      roleService: dependencies.roleService,
    }),
  );
  app.use(
    "/api/v1/admin/products",
    createProductsRouter({
      authenticate: dependencies.authenticate,
      productDocumentsService: dependencies.productDocumentsService,
      productRagAgentService: dependencies.productRagAgentService,
      productsService: dependencies.productsService,
      requireAdmin: dependencies.requireAdmin,
      requireCsrf: dependencies.requireCsrf,
      requireProductsRead: dependencies.requireProductsRead,
      requireProductsWrite: dependencies.requireProductsWrite,
    }),
  );
  app.use(
    "/api/v1/admin/reports",
    createReportsRouter({
      authenticate: dependencies.authenticate,
      consultationsReportService: dependencies.consultationsReportService,
      requireAdmin: dependencies.requireAdmin,
      requireReportsRead: dependencies.requireReportsRead,
    }),
  );
  app.use(
    "/api/v1/products",
    createChatRouter({
      authenticate: dependencies.authenticate,
      chatService: dependencies.chatService,
      requireAgentRead: dependencies.requireAgentRead,
      requireCsrf: dependencies.requireCsrf,
    }),
  );
  app.use(
    "/api/v1/agent",
    createAgentRouter({
      agentService: dependencies.agentService,
      authenticate: dependencies.authenticate,
      rateLimitSession: dependencies.rateLimitSession,
      requireAgentRead: dependencies.requireAgentRead,
      requireCsrf: dependencies.requireCsrf,
    }),
  );
  if (!dependencies.config.isProduction) {
    app.use(
      "/api/v1/development/gemini",
      createGeminiPreviewRouter({
        authenticate: dependencies.authenticate,
        chatService: dependencies.chatService,
        requireAgentRead: dependencies.requireAgentRead,
        requireCsrf: dependencies.requireCsrf,
      }),
    );
  }
  app.get("/api/v1/health", healthHandler);
  app.use(
    CLIENTE360_CONSULTA_PATH,
    dependencies.authenticate,
    dependencies.requireAgentRead,
    dependencies.requireCsrf,
  );
  app.use(cliente360Router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
