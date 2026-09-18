import type { Firestore } from "firebase-admin/firestore";

import { createAdministratorMiddleware, createPermissionMiddleware } from "./access/permission.middleware";
import { RoleRepository } from "./access/role.repository";
import { RoleService } from "./access/role.service";
import { UserRepository } from "./access/user.repository";
import { UserService } from "./access/user.service";
import { AuthService } from "./auth/auth.service";
import { createCsrfMiddleware } from "./auth/csrf.middleware";
import { createFirebaseTokenVerifier } from "./auth/firebase-admin-client";
import { SessionRepository } from "./auth/session.repository";
import { createAuthenticationMiddleware } from "./auth/session.middleware";
import { ChatService } from "./chat/chat.service";
import { createGeminiClient } from "./chat/gemini.client";
import { GeminiGateway } from "./chat/gemini.gateway";
import type { AppConfig } from "./config";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { ProductDocumentRepository } from "./products/product-document.repository";
import { ProductDocumentsService } from "./products/product-documents.service";
import { ProductRagAgentService } from "./products/product-rag-agent.service";
import { ProductRepository } from "./products/product.repository";
import { ProductsService } from "./products/products.service";
import { createDiscoveryEngineClients } from "./rag/discovery-engine.client";
import { DiscoveryEngineGateway } from "./rag/discovery-engine.gateway";
import { createRagStorageClient } from "./rag/gcs.client";
import { RagStorageGateway } from "./rag/gcs.gateway";

const AUTHENTICATION_RATE_LIMIT_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const AUTHENTICATION_RATE_LIMIT_MAX_REQUESTS = 10;
const SESSION_RATE_LIMIT_WINDOW_MILLISECONDS = 60 * 1_000;
const SESSION_RATE_LIMIT_MAX_REQUESTS = 120;

export interface ApplicationDependencies {
  readonly authenticate: import("express").RequestHandler;
  readonly authService: AuthService;
  readonly chatService: ChatService;
  readonly config: AppConfig;
  readonly productDocumentsService: ProductDocumentsService;
  readonly productRagAgentService: ProductRagAgentService;
  readonly productsService: ProductsService;
  readonly rateLimitAuthentication: import("express").RequestHandler;
  readonly rateLimitSession: import("express").RequestHandler;
  readonly requireAdmin: import("express").RequestHandler;
  readonly requireAgentRead: import("express").RequestHandler;
  readonly requireCsrf: import("express").RequestHandler;
  readonly requireProductsRead: import("express").RequestHandler;
  readonly requireProductsWrite: import("express").RequestHandler;
  readonly requireRolesRead: import("express").RequestHandler;
  readonly requireRolesWrite: import("express").RequestHandler;
  readonly requireUsersRead: import("express").RequestHandler;
  readonly requireUsersWrite: import("express").RequestHandler;
  readonly roleService: RoleService;
  readonly userService: UserService;
}

/** Assemble infrastructure adapters and application services for the HTTP layer. */
export function createApplicationDependencies(config: AppConfig, firestore: Firestore): ApplicationDependencies {
  const roleRepository = new RoleRepository(firestore);
  const userRepository = new UserRepository(firestore);
  const sessionRepository = new SessionRepository(firestore);
  const authService = new AuthService(
    createFirebaseTokenVerifier(config),
    userRepository,
    sessionRepository,
    config.session,
  );

  if (config.firebaseProjectId === undefined) {
    throw new Error(
      "FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is required for Discovery Engine and Cloud Storage integration.",
    );
  }

  const discoveryEngineClients = createDiscoveryEngineClients(config.rag.discoveryEngineLocation);
  const discoveryEngineGateway = new DiscoveryEngineGateway(
    discoveryEngineClients,
    config.firebaseProjectId,
    config.rag.discoveryEngineLocation,
  );

  const ragStorageClient = createRagStorageClient();
  const ragStorageGateway = new RagStorageGateway(ragStorageClient, config.rag.bucketName, config.rag.bucketLocation);

  const productRepository = new ProductRepository(firestore);
  const productDocumentRepository = new ProductDocumentRepository(firestore);
  const productsService = new ProductsService(
    productRepository,
    productDocumentRepository,
    discoveryEngineGateway,
    ragStorageGateway,
  );
  const productDocumentsService = new ProductDocumentsService(
    productRepository,
    productDocumentRepository,
    discoveryEngineGateway,
    ragStorageGateway,
    productsService,
  );

  const geminiClient = createGeminiClient(config.firebaseProjectId, config.gemini.location);
  const geminiGateway = new GeminiGateway(geminiClient, config.gemini.model);
  const productRagAgentService = new ProductRagAgentService(productsService, geminiGateway);
  const chatService = new ChatService(productsService, discoveryEngineGateway, geminiGateway);

  return {
    authenticate: createAuthenticationMiddleware(authService, config.session),
    authService,
    chatService,
    config,
    productDocumentsService,
    productRagAgentService,
    productsService,
    rateLimitAuthentication: createRateLimitMiddleware({
      maxRequests: AUTHENTICATION_RATE_LIMIT_MAX_REQUESTS,
      windowMilliseconds: AUTHENTICATION_RATE_LIMIT_WINDOW_MILLISECONDS,
    }),
    rateLimitSession: createRateLimitMiddleware({
      maxRequests: SESSION_RATE_LIMIT_MAX_REQUESTS,
      windowMilliseconds: SESSION_RATE_LIMIT_WINDOW_MILLISECONDS,
    }),
    requireAdmin: createAdministratorMiddleware(),
    requireAgentRead: createPermissionMiddleware("agent:read"),
    requireCsrf: createCsrfMiddleware(authService),
    requireProductsRead: createPermissionMiddleware("products:read"),
    requireProductsWrite: createPermissionMiddleware("products:write"),
    requireRolesRead: createPermissionMiddleware("roles:read"),
    requireRolesWrite: createPermissionMiddleware("roles:write"),
    requireUsersRead: createPermissionMiddleware("users:read"),
    requireUsersWrite: createPermissionMiddleware("users:write"),
    roleService: new RoleService(roleRepository),
    userService: new UserService(firestore, userRepository, roleRepository),
  };
}
