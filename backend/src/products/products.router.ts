import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../http/async-handler";
import { parseInput, uuidV4Schema } from "../validation";

import { createProductDocumentsRouter } from "./product-documents.router";
import type { ProductDocumentsService } from "./product-documents.service";
import type { ProductRagAgentService } from "./product-rag-agent.service";
import { toProductResponse } from "./products.models";
import { createProductInputSchema, updateProductInputSchema } from "./products.schemas";
import type { ProductsService } from "./products.service";
import { ragProbeInputSchema } from "./rag-probe.schemas";

export interface ProductsRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly productDocumentsService: ProductDocumentsService;
  readonly productRagAgentService: ProductRagAgentService;
  readonly productsService: ProductsService;
  readonly requireAdmin: RequestHandler;
  readonly requireCsrf: RequestHandler;
  readonly requireProductsRead: RequestHandler;
  readonly requireProductsWrite: RequestHandler;
}

/** Create ADMIN-only routes for product administration and their per-product RAG knowledge base. */
export function createProductsRouter(dependencies: ProductsRouterDependencies): Router {
  const router = Router();

  router.get(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsRead,
    asyncHandler(async (_request, response): Promise<void> => {
      const products = await dependencies.productsService.listProducts();
      response.status(200).json({ products: products.map(toProductResponse) });
    }),
  );

  router.post(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const product = await dependencies.productsService.createProduct(
        parseInput(createProductInputSchema, request.body),
        request.correlationId,
      );
      response.status(202).json({ product: toProductResponse(product) });
    }),
  );

  router.post(
    "/:productId/rag/probe",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsRead,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const probe = await dependencies.productsService.probeRag(
        parseInput(uuidV4Schema, request.params.productId),
        parseInput(ragProbeInputSchema, request.body),
        request.correlationId,
      );
      response.status(200).json(probe);
    }),
  );

  router.post(
    "/:productId/rag/ask",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsRead,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const answer = await dependencies.productRagAgentService.ask(
        parseInput(uuidV4Schema, request.params.productId),
        parseInput(ragProbeInputSchema, request.body),
        request.correlationId,
      );
      response.status(200).json(answer);
    }),
  );

  router.get(
    "/:productId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsRead,
    asyncHandler(async (request, response): Promise<void> => {
      const product = await dependencies.productsService.getProduct(
        parseInput(uuidV4Schema, request.params.productId),
        request.correlationId,
      );
      response.status(200).json({ product: toProductResponse(product) });
    }),
  );

  router.patch(
    "/:productId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const product = await dependencies.productsService.updateProduct(
        parseInput(uuidV4Schema, request.params.productId),
        parseInput(updateProductInputSchema, request.body),
      );
      response.status(200).json({ product: toProductResponse(product) });
    }),
  );

  router.delete(
    "/:productId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      await dependencies.productsService.deleteProduct(parseInput(uuidV4Schema, request.params.productId));
      response.status(204).send();
    }),
  );

  router.use(
    "/:productId/documents",
    createProductDocumentsRouter({
      authenticate: dependencies.authenticate,
      productDocumentsService: dependencies.productDocumentsService,
      requireAdmin: dependencies.requireAdmin,
      requireCsrf: dependencies.requireCsrf,
      requireProductsRead: dependencies.requireProductsRead,
      requireProductsWrite: dependencies.requireProductsWrite,
    }),
  );

  return router;
}
