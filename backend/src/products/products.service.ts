import { conflict, notFound } from "../errors";
import { logEvent, type LogFields } from "../logger";
import type { DiscoveryEngineGateway, RagProbeResponse } from "../rag/discovery-engine.gateway";
import { RagOperationError, toRagFailureLogDetails } from "../rag/rag.errors";
import type { RagStorageGateway } from "../rag/gcs.gateway";
import { buildProductObjectPrefix } from "../rag/rag.ids";

import { ProductDocumentRepository } from "./product-document.repository";
import { ProductRepository } from "./product.repository";
import type { Product } from "./products.models";
import type { CreateProductInput, UpdateProductInput } from "./products.schemas";
import type { RagProbeInput } from "./rag-probe.schemas";

const SYSTEM_CORRELATION_ID = "system";
type RagProvisioningStage = "data_store" | "engine";

/** Apply domain rules for product administration and their per-product RAG engine lifecycle. */
export class ProductsService {
  public constructor(
    private readonly productRepository: ProductRepository,
    private readonly productDocumentRepository: ProductDocumentRepository,
    private readonly discoveryEngineGateway: DiscoveryEngineGateway,
    private readonly ragStorageGateway: RagStorageGateway,
  ) {}

  /** Create a product, persist its RAG identity, and start its DataStore provisioning. */
  public async createProduct(
    input: CreateProductInput,
    correlationId = SYSTEM_CORRELATION_ID,
  ): Promise<Product> {
    const product = await this.initializeRagResource(await this.productRepository.create(input));
    logRagProvisioningStarted(correlationId, product.id, "data_store");

    try {
      const { operationName } = await this.discoveryEngineGateway.startDataStoreCreation(
        product.id,
        product.name,
      );
      logRagProvisioningAccepted(correlationId, product.id, "data_store", operationName);
      return this.productRepository.update({
        ...product,
        rag: { ...product.rag, dataStoreOperationName: operationName, errorReason: null, state: "creating" },
      });
    } catch (error: unknown) {
      logRagProvisioningFailure(correlationId, product.id, "data_store", error);
      return this.productRepository.update({
        ...product,
        rag: { ...product.rag, errorReason: toRagErrorReason(error), state: "error" },
      });
    }
  }

  /** Delete a product and cascade-delete its Engine, DataStore, GCS objects, and document metadata. */
  public async deleteProduct(productId: string): Promise<void> {
    const product = await this.requireProduct(productId);

    try {
      await this.discoveryEngineGateway.deleteEngine(productId);
      await this.discoveryEngineGateway.deleteDataStore(productId);
      await this.ragStorageGateway.deleteObjectsByPrefix(buildProductObjectPrefix(productId));
    } catch (error: unknown) {
      await this.productRepository.update({
        ...product,
        rag: { ...product.rag, errorReason: toRagErrorReason(error), state: "error" },
      });
      throw conflict();
    }

    await this.productDocumentRepository.deleteAllForProduct(productId);
    await this.productRepository.delete(productId);
  }

  /** Return one product with its RAG state reconciled against Discovery Engine. */
  public async getProduct(productId: string, correlationId = SYSTEM_CORRELATION_ID): Promise<Product> {
    return this.reconcileRagState(await this.requireProduct(productId), correlationId);
  }

  /** Return every product without reconciling their RAG state (kept cheap for a listing). */
  public async listProducts(): Promise<readonly Product[]> {
    return this.productRepository.list();
  }

  /** Probe an active product engine using the strict retrieval configuration required by the mini agent. */
  public async probeRag(
    productId: string,
    input: RagProbeInput,
    correlationId = SYSTEM_CORRELATION_ID,
  ): Promise<RagProbeResponse> {
    const product = await this.getProduct(productId, correlationId);
    if (product.rag.state !== "active") {
      throw conflict();
    }

    return this.discoveryEngineGateway.probe(product.id, input);
  }

  /** Advance a product RAG state by checking Engine first, then DataStore, and creating only missing resources. */
  public async reconcileRagState(product: Product, correlationId = SYSTEM_CORRELATION_ID): Promise<Product> {
    if (product.rag.state !== "creating") {
      return product;
    }

    const initializedProduct = await this.initializeRagResource(product);
    const engineExists = await this.discoveryEngineGateway.engineExists(initializedProduct.id);
    if (engineExists) {
      return this.productRepository.update({
        ...initializedProduct,
        rag: {
          ...initializedProduct.rag,
          dataStoreOperationName: null,
          engineOperationName: null,
          errorReason: null,
          state: "active",
        },
      });
    }

    const dataStoreExists = await this.discoveryEngineGateway.dataStoreExists(initializedProduct.id);
    if (!dataStoreExists || initializedProduct.rag.engineOperationName !== null) {
      return initializedProduct;
    }

    logRagProvisioningStarted(correlationId, initializedProduct.id, "engine");
    try {
      const { operationName } = await this.discoveryEngineGateway.startEngineCreation(
        initializedProduct.id,
        initializedProduct.name,
      );
      logRagProvisioningAccepted(correlationId, initializedProduct.id, "engine", operationName);
      return this.productRepository.update({
        ...initializedProduct,
        rag: { ...initializedProduct.rag, engineOperationName: operationName, errorReason: null, state: "creating" },
      });
    } catch (error: unknown) {
      logRagProvisioningFailure(correlationId, initializedProduct.id, "engine", error);
      return this.productRepository.update({
        ...initializedProduct,
        rag: { ...initializedProduct.rag, errorReason: toRagErrorReason(error), state: "error" },
      });
    }
  }

  /** Apply mutations to a product's display fields; never touches its RAG resources. */
  public async updateProduct(productId: string, input: UpdateProductInput): Promise<Product> {
    const product = await this.requireProduct(productId);
    return this.productRepository.update({
      ...product,
      icon: input.icon ?? product.icon,
      name: input.name ?? product.name,
    });
  }

  /** Persist the exact GCP project, location, and deterministic resource ids for a product once. */
  private async initializeRagResource(product: Product): Promise<Product> {
    if (
      product.rag.projectId !== null &&
      product.rag.location !== null &&
      product.rag.dataStoreId !== null &&
      product.rag.engineId !== null
    ) {
      return product;
    }

    const ragResource = this.discoveryEngineGateway.buildRagResource(product.id);
    return this.productRepository.update({
      ...product,
      rag: {
        ...product.rag,
        dataStoreId: ragResource.dataStoreId,
        engineId: ragResource.engineId,
        location: ragResource.location,
        projectId: ragResource.projectId,
      },
    });
  }

  private async requireProduct(productId: string): Promise<Product> {
    const product = await this.productRepository.findById(productId);
    if (product === null) {
      throw notFound();
    }

    return product;
  }
}

/** Write the start of one asynchronous Discovery Engine resource creation request. */
function logRagProvisioningStarted(
  correlationId: string,
  productId: string,
  stage: RagProvisioningStage,
): void {
  logEvent("INFO", `rag_${stage}_creation_started`, createRagLogFields(correlationId, productId, stage));
}

/** Write an accepted asynchronous resource creation request without claiming completion. */
function logRagProvisioningAccepted(
  correlationId: string,
  productId: string,
  stage: RagProvisioningStage,
  operationName: string | null,
): void {
  logEvent("INFO", `rag_${stage}_creation_request_accepted`, {
    ...createRagLogFields(correlationId, productId, stage),
    operationPending: operationName !== null,
    ragOperationName: operationName ?? "not-returned",
  });
}

/** Write sanitized provider diagnostics when Discovery Engine rejects a creation request. */
function logRagProvisioningFailure(
  correlationId: string,
  productId: string,
  stage: RagProvisioningStage,
  error: unknown,
): void {
  logEvent("ERROR", `rag_${stage}_creation_failed`, {
    ...createRagLogFields(correlationId, productId, stage),
    ...toRagFailureLogDetails(error),
  });
}

/** Build the mandatory trace fields shared by all RAG provisioning events. */
function createRagLogFields(
  correlationId: string,
  productId: string,
  stage: RagProvisioningStage,
): LogFields {
  return {
    correlationId,
    requestId: correlationId,
    productId,
    ragStage: stage,
  };
}

/** Map an internal RAG failure to the safe reason persisted on the product. */
function toRagErrorReason(error: unknown): "DATASTORE_CREATE_FAILED" | "ENGINE_CREATE_FAILED" | "UNKNOWN" {
  if (error instanceof RagOperationError && (error.reason === "DATASTORE_CREATE_FAILED" || error.reason === "ENGINE_CREATE_FAILED")) {
    return error.reason;
  }

  return "UNKNOWN";
}
