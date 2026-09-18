export const PRODUCT_RAG_STATES = ["none", "creating", "active", "error"] as const;
export type ProductRagState = (typeof PRODUCT_RAG_STATES)[number];

export const PRODUCT_RAG_ERROR_REASONS = ["DATASTORE_CREATE_FAILED", "ENGINE_CREATE_FAILED", "UNKNOWN"] as const;
export type ProductRagErrorReason = (typeof PRODUCT_RAG_ERROR_REASONS)[number];

export const PRODUCT_DOCUMENT_STATUSES = ["indexing", "indexed", "error"] as const;
export type ProductDocumentStatus = (typeof PRODUCT_DOCUMENT_STATUSES)[number];

export const PRODUCT_DOCUMENT_ERROR_REASONS = ["IMPORT_FAILED", "DELETE_FAILED", "UNKNOWN"] as const;
export type ProductDocumentErrorReason = (typeof PRODUCT_DOCUMENT_ERROR_REASONS)[number];

export const ALLOWED_DOCUMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const MAX_DOCUMENT_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export interface ProductRag {
  readonly dataStoreId: string | null;
  readonly dataStoreOperationName: string | null;
  readonly engineId: string | null;
  readonly engineOperationName: string | null;
  readonly errorReason: ProductRagErrorReason | null;
  readonly location: string | null;
  readonly projectId: string | null;
  readonly state: ProductRagState;
}

export interface Product {
  readonly createdAt: Date;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly rag: ProductRag;
  readonly updatedAt: Date;
}

export interface ProductRagResponse {
  readonly errorReason: ProductRagErrorReason | null;
  readonly state: ProductRagState;
}

export interface ProductResponse {
  readonly createdAt: string;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly rag: ProductRagResponse;
  readonly updatedAt: string;
}

export interface ProductDocumentRecord {
  readonly contentType: string;
  readonly createdAt: Date;
  readonly engineDocumentId: string | null;
  readonly errorReason: ProductDocumentErrorReason | null;
  readonly fileName: string;
  readonly gcsObjectPath: string;
  readonly id: string;
  readonly productId: string;
  readonly sizeBytes: number;
  readonly status: ProductDocumentStatus;
  readonly updatedAt: Date;
}

export interface ProductDocumentResponse {
  readonly contentType: string;
  readonly createdAt: string;
  readonly engineDocumentId: string | null;
  readonly errorReason: ProductDocumentErrorReason | null;
  readonly fileName: string;
  readonly id: string;
  readonly productId: string;
  readonly sizeBytes: number;
  readonly status: ProductDocumentStatus;
  readonly updatedAt: string;
}

/** Convert an internal product to its explicit API representation. */
export function toProductResponse(product: Product): ProductResponse {
  return {
    createdAt: product.createdAt.toISOString(),
    icon: product.icon,
    id: product.id,
    name: product.name,
    rag: {
      errorReason: product.rag.errorReason,
      state: product.rag.state,
    },
    updatedAt: product.updatedAt.toISOString(),
  };
}

/** Convert an internal product document record into an explicit API response without its GCS object path. */
export function toProductDocumentResponse(document: ProductDocumentRecord): ProductDocumentResponse {
  return {
    contentType: document.contentType,
    createdAt: document.createdAt.toISOString(),
    engineDocumentId: document.engineDocumentId,
    errorReason: document.errorReason,
    fileName: document.fileName,
    id: document.id,
    productId: document.productId,
    sizeBytes: document.sizeBytes,
    status: document.status,
    updatedAt: document.updatedAt.toISOString(),
  };
}
