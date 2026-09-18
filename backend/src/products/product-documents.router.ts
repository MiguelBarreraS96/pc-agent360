import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../http/async-handler";
import { parseSingleFileUpload } from "../http/multipart";
import { parseInput, uuidV4Schema } from "../validation";

import { ALLOWED_DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_UPLOAD_SIZE_BYTES, toProductDocumentResponse } from "./products.models";
import type { ProductDocumentsService } from "./product-documents.service";

export interface ProductDocumentsRouterDependencies {
  readonly authenticate: RequestHandler;
  readonly productDocumentsService: ProductDocumentsService;
  readonly requireAdmin: RequestHandler;
  readonly requireCsrf: RequestHandler;
  readonly requireProductsRead: RequestHandler;
  readonly requireProductsWrite: RequestHandler;
}

/** Create ADMIN-only routes for a product's source documents. Mounted with `mergeParams` under `/products/:productId`. */
export function createProductDocumentsRouter(dependencies: ProductDocumentsRouterDependencies): Router {
  const router = Router({ mergeParams: true });

  router.get(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsRead,
    asyncHandler(async (request, response): Promise<void> => {
      const documents = await dependencies.productDocumentsService.listDocuments(
        parseInput(uuidV4Schema, request.params.productId),
      );
      response.status(200).json({ documents: documents.map(toProductDocumentResponse) });
    }),
  );

  router.post(
    "/",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      const productId = parseInput(uuidV4Schema, request.params.productId);
      const upload = await parseSingleFileUpload(request, {
        allowedContentTypes: ALLOWED_DOCUMENT_CONTENT_TYPES,
        maxSizeBytes: MAX_DOCUMENT_UPLOAD_SIZE_BYTES,
      });
      const document = await dependencies.productDocumentsService.uploadDocument(
        productId,
        upload,
        request.correlationId,
      );
      response.status(202).json({ document: toProductDocumentResponse(document) });
    }),
  );

  router.delete(
    "/:documentId",
    dependencies.authenticate,
    dependencies.requireAdmin,
    dependencies.requireProductsWrite,
    dependencies.requireCsrf,
    asyncHandler(async (request, response): Promise<void> => {
      await dependencies.productDocumentsService.deleteDocument(
        parseInput(uuidV4Schema, request.params.productId),
        parseInput(uuidV4Schema, request.params.documentId),
      );
      response.status(204).send();
    }),
  );

  return router;
}
