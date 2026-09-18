import { randomUUID } from "node:crypto";

import { badRequest, conflict, notFound } from "../errors";
import type { ParsedUpload } from "../http/multipart";
import { FileSizeLimitExceededError } from "../http/multipart";
import type { DiscoveryEngineGateway } from "../rag/discovery-engine.gateway";
import type { RagStorageGateway } from "../rag/gcs.gateway";
import { RagOperationError } from "../rag/rag.errors";
import { buildGcsObjectPath } from "../rag/rag.ids";

import { ProductDocumentRepository } from "./product-document.repository";
import { ProductRepository } from "./product.repository";
import { ALLOWED_DOCUMENT_CONTENT_TYPES, type ProductDocumentRecord } from "./products.models";
import { sanitizeFileName } from "./products.schemas";
import type { ProductsService } from "./products.service";

/** Apply domain rules for a product's source documents: upload, listing reconciliation, and deletion. */
export class ProductDocumentsService {
  public constructor(
    private readonly productRepository: ProductRepository,
    private readonly productDocumentRepository: ProductDocumentRepository,
    private readonly discoveryEngineGateway: DiscoveryEngineGateway,
    private readonly ragStorageGateway: RagStorageGateway,
    private readonly productsService: ProductsService,
  ) {}

  /** Delete a document: engine representation, then its GCS object, then its Firestore record, in that order. */
  public async deleteDocument(productId: string, documentId: string): Promise<void> {
    const record = await this.requireDocument(productId, documentId);

    let engineDocumentId = record.engineDocumentId;
    if (engineDocumentId === null) {
      engineDocumentId = await this.discoveryEngineGateway.findEngineDocumentIdByUri(
        productId,
        this.ragStorageGateway.buildUri(record.gcsObjectPath),
      );
    }

    if (engineDocumentId !== null) {
      try {
        await this.discoveryEngineGateway.deleteEngineDocument(productId, engineDocumentId);
      } catch (error: unknown) {
        await this.markDocumentFailed(record, error);
        throw conflict();
      }
    }

    try {
      await this.ragStorageGateway.deleteObject(record.gcsObjectPath);
    } catch (error: unknown) {
      await this.markDocumentFailed(record, error);
      throw conflict();
    }

    await this.productDocumentRepository.delete(documentId);
  }

  /** List a product's document records, reconciling any still-indexing record against Discovery Engine. */
  public async listDocuments(productId: string): Promise<readonly ProductDocumentRecord[]> {
    await this.requireProduct(productId);
    const records = await this.productDocumentRepository.findByProductId(productId);
    const indexingRecords = records.filter((record) => record.status === "indexing");
    if (indexingRecords.length === 0) {
      return records;
    }

    const reconciled = new Map<string, ProductDocumentRecord>();
    for (const record of indexingRecords) {
      const engineDocumentId = await this.discoveryEngineGateway.findEngineDocumentIdByUri(
        productId,
        this.ragStorageGateway.buildUri(record.gcsObjectPath),
      );
      if (engineDocumentId !== null) {
        const updated = await this.productDocumentRepository.update({
          ...record,
          engineDocumentId,
          status: "indexed",
        });
        reconciled.set(record.id, updated);
      }
    }

    return records.map((record) => reconciled.get(record.id) ?? record);
  }

  /** Upload a new source document, store it in GCS, and start its incremental import into the product's Engine. */
  public async uploadDocument(
    productId: string,
    upload: ParsedUpload,
    correlationId: string,
  ): Promise<ProductDocumentRecord> {
    const product = await this.productsService.reconcileRagState(
      await this.requireProduct(productId),
      correlationId,
    );
    if (product.rag.state !== "active") {
      throw conflict();
    }

    if (!ALLOWED_DOCUMENT_CONTENT_TYPES.has(upload.contentType)) {
      throw badRequest();
    }

    const documentId = randomUUID();
    const sanitizedFileName = sanitizeFileName(upload.fileName);
    const objectPath = buildGcsObjectPath(productId, documentId, sanitizedFileName);

    let sizeBytes: number;
    try {
      const result = await this.ragStorageGateway.uploadObjectFromStream(objectPath, upload.stream, upload.contentType);
      sizeBytes = result.sizeBytes;
    } catch (error: unknown) {
      if (error instanceof RagOperationError && error.cause instanceof FileSizeLimitExceededError) {
        throw badRequest();
      }

      throw error;
    }

    const record = await this.productDocumentRepository.create({
      contentType: upload.contentType,
      engineDocumentId: null,
      errorReason: null,
      fileName: sanitizedFileName,
      gcsObjectPath: objectPath,
      id: documentId,
      productId,
      sizeBytes,
      status: "indexing",
    });

    try {
      await this.discoveryEngineGateway.importDocument(productId, this.ragStorageGateway.buildUri(objectPath));
      return record;
    } catch (error: unknown) {
      return this.productDocumentRepository.update({
        ...record,
        errorReason: "IMPORT_FAILED",
        status: "error",
      });
    }
  }

  private async markDocumentFailed(record: ProductDocumentRecord, error: unknown): Promise<void> {
    const errorReason = error instanceof RagOperationError && error.reason === "DELETE_FAILED" ? "DELETE_FAILED" : "UNKNOWN";
    await this.productDocumentRepository.update({ ...record, errorReason, status: "error" });
  }

  private async requireDocument(productId: string, documentId: string): Promise<ProductDocumentRecord> {
    const record = await this.productDocumentRepository.findById(documentId);
    if (record === null || record.productId !== productId) {
      throw notFound();
    }

    return record;
  }

  private async requireProduct(productId: string) {
    const product = await this.productRepository.findById(productId);
    if (product === null) {
      throw notFound();
    }

    return product;
  }
}
