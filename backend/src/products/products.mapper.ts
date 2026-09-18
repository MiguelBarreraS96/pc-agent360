import type { Timestamp } from "firebase-admin/firestore";

import {
  PRODUCT_DOCUMENT_ERROR_REASONS,
  PRODUCT_DOCUMENT_STATUSES,
  PRODUCT_RAG_ERROR_REASONS,
  PRODUCT_RAG_STATES,
  type Product,
  type ProductDocumentErrorReason,
  type ProductDocumentRecord,
  type ProductDocumentStatus,
  type ProductRagErrorReason,
  type ProductRagState,
} from "./products.models";

const MAX_RAG_RESOURCE_VALUE_LENGTH = 255;

export interface ProductDocument {
  readonly createdAt: Timestamp;
  readonly icon: string;
  readonly name: string;
  readonly ragDataStoreId?: string | null;
  readonly ragDataStoreOperationName: string | null;
  readonly ragEngineId?: string | null;
  readonly ragEngineOperationName: string | null;
  readonly ragErrorReason: string | null;
  readonly ragLocation?: string | null;
  readonly ragProjectId?: string | null;
  readonly ragState: string;
  readonly updatedAt: Timestamp;
}

export interface ProductDocumentRecordDocument {
  readonly contentType: string;
  readonly createdAt: Timestamp;
  readonly engineDocumentId: string | null;
  readonly errorReason: string | null;
  readonly fileName: string;
  readonly gcsObjectPath: string;
  readonly productId: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly updatedAt: Timestamp;
}

/** Convert a Firestore product document into a validated domain product. */
export function mapProductDocument(productId: string, document: ProductDocument): Product {
  return {
    createdAt: document.createdAt.toDate(),
    icon: document.icon,
    id: productId,
    name: document.name,
    rag: {
      dataStoreId: parseRagResourceValue(document.ragDataStoreId),
      dataStoreOperationName: document.ragDataStoreOperationName,
      engineId: parseRagResourceValue(document.ragEngineId),
      engineOperationName: document.ragEngineOperationName,
      errorReason: parseRagErrorReason(document.ragErrorReason),
      location: parseRagResourceValue(document.ragLocation),
      projectId: parseRagResourceValue(document.ragProjectId),
      state: parseRagState(document.ragState),
    },
    updatedAt: document.updatedAt.toDate(),
  };
}

/** Convert a Firestore product document record into a validated domain document record. */
export function mapProductDocumentRecord(documentId: string, document: ProductDocumentRecordDocument): ProductDocumentRecord {
  return {
    contentType: document.contentType,
    createdAt: document.createdAt.toDate(),
    engineDocumentId: document.engineDocumentId,
    errorReason: parseDocumentErrorReason(document.errorReason),
    fileName: document.fileName,
    gcsObjectPath: document.gcsObjectPath,
    id: documentId,
    productId: document.productId,
    sizeBytes: document.sizeBytes,
    status: parseDocumentStatus(document.status),
    updatedAt: document.updatedAt.toDate(),
  };
}

/** Decode a Firestore RAG state only when it exactly matches the application allowlist. */
function parseRagState(value: string): ProductRagState {
  if (!(PRODUCT_RAG_STATES as readonly string[]).includes(value)) {
    throw new Error("Firestore returned an invalid product RAG state.");
  }

  return value as ProductRagState;
}

/** Decode a Firestore RAG error reason only when it exactly matches the application allowlist. */
function parseRagErrorReason(value: string | null): ProductRagErrorReason | null {
  if (value === null) {
    return null;
  }

  if (!(PRODUCT_RAG_ERROR_REASONS as readonly string[]).includes(value)) {
    throw new Error("Firestore returned an invalid product RAG error reason.");
  }

  return value as ProductRagErrorReason;
}

/** Decode persisted project, location, or resource ids while tolerating pre-migration product records. */
function parseRagResourceValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.trim() === "" || value.length > MAX_RAG_RESOURCE_VALUE_LENGTH) {
    throw new Error("Firestore returned an invalid product RAG resource value.");
  }

  return value;
}

/** Decode a Firestore document status only when it exactly matches the application allowlist. */
function parseDocumentStatus(value: string): ProductDocumentStatus {
  if (!(PRODUCT_DOCUMENT_STATUSES as readonly string[]).includes(value)) {
    throw new Error("Firestore returned an invalid document status.");
  }

  return value as ProductDocumentStatus;
}

/** Decode a Firestore document error reason only when it exactly matches the application allowlist. */
function parseDocumentErrorReason(value: string | null): ProductDocumentErrorReason | null {
  if (value === null) {
    return null;
  }

  if (!(PRODUCT_DOCUMENT_ERROR_REASONS as readonly string[]).includes(value)) {
    throw new Error("Firestore returned an invalid document error reason.");
  }

  return value as ProductDocumentErrorReason;
}
