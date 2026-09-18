import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  CreateProductRequest,
  ProductDocumentDto,
  ProductDocumentEnvelope,
  ProductDocumentsEnvelope,
  ProductDto,
  ProductEnvelope,
  ProductRagAgentResponse,
  ProductsEnvelope,
  RagProbeRequest,
  RagProbeResponse,
  UpdateProductRequest,
} from './api.models';
import { RUNTIME_CONFIG, RuntimeConfig } from './runtime-config';

/** Provides typed administration calls that mirror the backend's products and RAG document contracts. */
@Injectable({ providedIn: 'root' })
export class ProductsApiService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject<RuntimeConfig>(RUNTIME_CONFIG);

  /** List every product without reconciling its RAG engine state. */
  async listProducts(): Promise<readonly ProductDto[]> {
    const response = await firstValueFrom(this.http.get<ProductsEnvelope>(this.endpoint('/admin/products')));
    return response.products;
  }

  /** Create a product and start provisioning its RAG engine asynchronously. */
  async createProduct(request: CreateProductRequest): Promise<ProductDto> {
    const response = await firstValueFrom(this.http.post<ProductEnvelope>(this.endpoint('/admin/products'), request));
    return response.product;
  }

  /** Fetch one product, reconciling its RAG engine state against Discovery Engine. */
  async getProduct(productId: string): Promise<ProductDto> {
    const response = await firstValueFrom(
      this.http.get<ProductEnvelope>(this.endpoint(`/admin/products/${encodeURIComponent(productId)}`)),
    );
    return response.product;
  }

  /** Retrieve bounded Discovery Engine evidence without invoking Gemini. */
  async probeProductRag(productId: string, request: RagProbeRequest): Promise<RagProbeResponse> {
    return firstValueFrom(
      this.http.post<RagProbeResponse>(
        this.endpoint(`/admin/products/${encodeURIComponent(productId)}/rag/probe`),
        request,
      ),
    );
  }

  /** Retrieve product evidence and ask Gemini to answer exclusively from that evidence. */
  async askProductRag(productId: string, request: RagProbeRequest): Promise<ProductRagAgentResponse> {
    return firstValueFrom(
      this.http.post<ProductRagAgentResponse>(
        this.endpoint(`/admin/products/${encodeURIComponent(productId)}/rag/ask`),
        request,
      ),
    );
  }

  /** Update a product's name or icon; never affects its RAG engine. */
  async updateProduct(productId: string, request: UpdateProductRequest): Promise<ProductDto> {
    const response = await firstValueFrom(
      this.http.patch<ProductEnvelope>(this.endpoint(`/admin/products/${encodeURIComponent(productId)}`), request),
    );
    return response.product;
  }

  /** Delete a product and cascade-delete its RAG engine, documents and stored files. */
  async deleteProduct(productId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.endpoint(`/admin/products/${encodeURIComponent(productId)}`)));
  }

  /** List a product's source documents, reconciling any still-indexing record. */
  async listDocuments(productId: string): Promise<readonly ProductDocumentDto[]> {
    const response = await firstValueFrom(
      this.http.get<ProductDocumentsEnvelope>(this.endpoint(`/admin/products/${encodeURIComponent(productId)}/documents`)),
    );
    return response.documents;
  }

  /** Upload one source document to a product's active RAG engine. */
  async uploadDocument(productId: string, file: File): Promise<ProductDocumentDto> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await firstValueFrom(
      this.http.post<ProductDocumentEnvelope>(
        this.endpoint(`/admin/products/${encodeURIComponent(productId)}/documents`),
        formData,
      ),
    );
    return response.document;
  }

  /** Delete a source document from a product's RAG engine, storage and metadata. */
  async deleteDocument(productId: string, documentId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(
        this.endpoint(`/admin/products/${encodeURIComponent(productId)}/documents/${encodeURIComponent(documentId)}`),
      ),
    );
  }

  /** Build endpoints from the validated backend base URL. */
  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }
}
