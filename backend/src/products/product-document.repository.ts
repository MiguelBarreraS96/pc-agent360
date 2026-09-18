import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { mapProductDocumentRecord, type ProductDocumentRecordDocument } from "./products.mapper";
import type { ProductDocumentRecord } from "./products.models";

const PRODUCT_DOCUMENTS_COLLECTION = "productDocuments";
const BATCH_DELETE_SIZE = 400;

/** Read and persist product document records in Firestore, optionally participating in a caller-managed transaction. */
export class ProductDocumentRepository {
  public constructor(
    private readonly firestore: Firestore,
    private readonly transaction?: Transaction,
  ) {}

  /**
   * Create a product document record under a caller-supplied id.
   * The id is chosen by the caller (not generated here) because it is embedded in the Cloud Storage
   * object path used to upload the file before this record is persisted.
   */
  public async create(record: Omit<ProductDocumentRecord, "createdAt" | "updatedAt">): Promise<ProductDocumentRecord> {
    const now = Timestamp.now();
    const document: ProductDocumentRecordDocument = {
      contentType: record.contentType,
      createdAt: now,
      engineDocumentId: record.engineDocumentId,
      errorReason: record.errorReason,
      fileName: record.fileName,
      gcsObjectPath: record.gcsObjectPath,
      productId: record.productId,
      sizeBytes: record.sizeBytes,
      status: record.status,
      updatedAt: now,
    };

    await this.setDoc(this.documentRef(record.id), document);
    return mapProductDocumentRecord(record.id, document);
  }

  /** Delete a single product document record. */
  public async delete(documentId: string): Promise<boolean> {
    const snapshot = await this.getDoc(this.documentRef(documentId));
    if (!snapshot.exists) {
      return false;
    }

    await this.deleteDoc(this.documentRef(documentId));
    return true;
  }

  /** Delete every document record belonging to a product, used only by the product delete cascade. */
  public async deleteAllForProduct(productId: string): Promise<void> {
    const snapshot = await this.getQuery(this.documentsCollection().where("productId", "==", productId));
    for (let offset = 0; offset < snapshot.docs.length; offset += BATCH_DELETE_SIZE) {
      const batch = this.firestore.batch();
      for (const document of snapshot.docs.slice(offset, offset + BATCH_DELETE_SIZE)) {
        batch.delete(document.ref);
      }

      await batch.commit();
    }
  }

  /** Find a document record by its UUID. */
  public async findById(documentId: string): Promise<ProductDocumentRecord | null> {
    const snapshot = await this.getDoc(this.documentRef(documentId));
    return snapshot.exists
      ? mapProductDocumentRecord(documentId, snapshot.data() as ProductDocumentRecordDocument)
      : null;
  }

  /** Return every document record belonging to a product, sorted by creation time. */
  public async findByProductId(productId: string): Promise<readonly ProductDocumentRecord[]> {
    const snapshot = await this.getQuery(this.documentsCollection().where("productId", "==", productId));
    return snapshot.docs
      .map((document) => mapProductDocumentRecord(document.id, document.data() as ProductDocumentRecordDocument))
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  }

  /** Replace a document record's stored fields. */
  public async update(record: ProductDocumentRecord): Promise<ProductDocumentRecord> {
    const document: ProductDocumentRecordDocument = {
      contentType: record.contentType,
      createdAt: Timestamp.fromDate(record.createdAt),
      engineDocumentId: record.engineDocumentId,
      errorReason: record.errorReason,
      fileName: record.fileName,
      gcsObjectPath: record.gcsObjectPath,
      productId: record.productId,
      sizeBytes: record.sizeBytes,
      status: record.status,
      updatedAt: Timestamp.now(),
    };

    await this.setDoc(this.documentRef(record.id), document);
    return mapProductDocumentRecord(record.id, document);
  }

  private documentsCollection() {
    return this.firestore.collection(PRODUCT_DOCUMENTS_COLLECTION);
  }

  private documentRef(documentId: string): DocumentReference {
    return this.documentsCollection().doc(documentId);
  }

  private async getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    return this.transaction ? this.transaction.get(ref) : ref.get();
  }

  private async getQuery(query: Query): Promise<QuerySnapshot> {
    return this.transaction ? this.transaction.get(query) : query.get();
  }

  private async setDoc(ref: DocumentReference, data: ProductDocumentRecordDocument): Promise<void> {
    if (this.transaction) {
      this.transaction.set(ref, data);
      return;
    }

    await ref.set(data);
  }

  private async deleteDoc(ref: DocumentReference): Promise<void> {
    if (this.transaction) {
      this.transaction.delete(ref);
      return;
    }

    await ref.delete();
  }
}
