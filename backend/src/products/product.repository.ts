import { randomUUID } from "node:crypto";

import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { mapProductDocument, type ProductDocument } from "./products.mapper";
import type { Product } from "./products.models";
import type { CreateProductInput } from "./products.schemas";

const PRODUCTS_COLLECTION = "products";

/** Read and persist products in Firestore, optionally participating in a caller-managed transaction. */
export class ProductRepository {
  public constructor(
    private readonly firestore: Firestore,
    private readonly transaction?: Transaction,
  ) {}

  /** Create a product record with its RAG provisioning already marked as in progress. */
  public async create(input: CreateProductInput): Promise<Product> {
    const productId = randomUUID();
    const now = Timestamp.now();
    const document: ProductDocument = {
      createdAt: now,
      icon: input.icon,
      name: input.name,
      ragDataStoreId: null,
      ragDataStoreOperationName: null,
      ragEngineId: null,
      ragEngineOperationName: null,
      ragErrorReason: null,
      ragLocation: null,
      ragProjectId: null,
      ragState: "creating",
      updatedAt: now,
    };

    await this.setDoc(this.productRef(productId), document);
    return mapProductDocument(productId, document);
  }

  /** Delete a product record. */
  public async delete(productId: string): Promise<boolean> {
    const snapshot = await this.getDoc(this.productRef(productId));
    if (!snapshot.exists) {
      return false;
    }

    await this.deleteDoc(this.productRef(productId));
    return true;
  }

  /** Find a product by its UUID. */
  public async findById(productId: string): Promise<Product | null> {
    const snapshot = await this.getDoc(this.productRef(productId));
    return snapshot.exists ? mapProductDocument(productId, snapshot.data() as ProductDocument) : null;
  }

  /** Return every product in creation order. */
  public async list(): Promise<readonly Product[]> {
    const snapshot = await this.getQuery(this.productsCollection().orderBy("createdAt", "asc"));
    return snapshot.docs.map((document) => mapProductDocument(document.id, document.data() as ProductDocument));
  }

  /** Replace a product's stored fields. */
  public async update(product: Product): Promise<Product> {
    const document: ProductDocument = {
      createdAt: Timestamp.fromDate(product.createdAt),
      icon: product.icon,
      name: product.name,
      ragDataStoreId: product.rag.dataStoreId,
      ragDataStoreOperationName: product.rag.dataStoreOperationName,
      ragEngineId: product.rag.engineId,
      ragEngineOperationName: product.rag.engineOperationName,
      ragErrorReason: product.rag.errorReason,
      ragLocation: product.rag.location,
      ragProjectId: product.rag.projectId,
      ragState: product.rag.state,
      updatedAt: Timestamp.now(),
    };

    await this.setDoc(this.productRef(product.id), document);
    return mapProductDocument(product.id, document);
  }

  private productsCollection() {
    return this.firestore.collection(PRODUCTS_COLLECTION);
  }

  private productRef(productId: string): DocumentReference {
    return this.productsCollection().doc(productId);
  }

  private async getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    return this.transaction ? this.transaction.get(ref) : ref.get();
  }

  private async getQuery(query: Query): Promise<QuerySnapshot> {
    return this.transaction ? this.transaction.get(query) : query.get();
  }

  private async setDoc(ref: DocumentReference, data: ProductDocument): Promise<void> {
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
