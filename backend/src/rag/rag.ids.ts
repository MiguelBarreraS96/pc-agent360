const DATA_STORE_PREFIX = "agencia-ds";
const ENGINE_PREFIX = "agencia-eng";
const COLLECTION_ID = "default_collection";
const DEFAULT_BRANCH_ID = "default_branch";
const DEFAULT_SERVING_CONFIG_ID = "default_search";

export interface RagResourceIds {
  readonly dataStoreId: string;
  readonly engineId: string;
}

export interface RagResource {
  readonly dataStoreId: string;
  readonly engineId: string;
  readonly location: string;
  readonly projectId: string;
}

/** Generate deterministic Discovery Engine identifiers from a normalized product identifier. */
export function buildRagResourceIds(productId: string): RagResourceIds {
  const safeProductId = normalizeProductId(productId);
  return {
    dataStoreId: `${DATA_STORE_PREFIX}-${safeProductId}`,
    engineId: `${ENGINE_PREFIX}-${safeProductId}`,
  };
}

/** Build the Discovery Engine collection parent from a configured project and location. */
export function collectionPath(projectId: string, location: string): string {
  return `projects/${projectId}/locations/${location}/collections/${COLLECTION_ID}`;
}

/** Build the Discovery Engine collection parent for one persisted RAG resource. */
export function buildCollectionPath(rag: RagResource): string {
  return collectionPath(rag.projectId, rag.location);
}

/** Build the full resource path for one persisted DataStore. */
export function buildDataStorePath(rag: RagResource): string {
  return `${buildCollectionPath(rag)}/dataStores/${rag.dataStoreId}`;
}

/** Build the full resource path for one persisted Engine. */
export function buildEnginePath(rag: RagResource): string {
  return `${buildCollectionPath(rag)}/engines/${rag.engineId}`;
}

/** Build the serving configuration path for one persisted Engine. */
export function buildServingConfigPath(rag: RagResource): string {
  return `${buildEnginePath(rag)}/servingConfigs/${DEFAULT_SERVING_CONFIG_ID}`;
}

/** Build the default branch path for one persisted DataStore. */
export function buildDefaultBranchPath(rag: RagResource): string {
  return `${buildDataStorePath(rag)}/branches/${DEFAULT_BRANCH_ID}`;
}

/** Derive the deterministic Discovery Engine DataStore id for legacy product-id callers. */
export function deriveDataStoreId(productId: string): string {
  return buildRagResourceIds(productId).dataStoreId;
}

/** Derive the deterministic Discovery Engine Engine id for legacy product-id callers. */
export function deriveEngineId(productId: string): string {
  return buildRagResourceIds(productId).engineId;
}

/** Build a DataStore path from the configured project, location and a legacy product id. */
export function dataStorePath(projectId: string, location: string, productId: string): string {
  return buildDataStorePath({
    projectId,
    location,
    ...buildRagResourceIds(productId),
  });
}

/** Build an Engine path from the configured project, location and a legacy product id. */
export function enginePath(projectId: string, location: string, productId: string): string {
  return buildEnginePath({
    projectId,
    location,
    ...buildRagResourceIds(productId),
  });
}

/** Build a serving configuration path from the configured project, location and a legacy product id. */
export function servingConfigPath(projectId: string, location: string, productId: string): string {
  return buildServingConfigPath({
    projectId,
    location,
    ...buildRagResourceIds(productId),
  });
}

/** Build a default branch path from the configured project, location and a legacy product id. */
export function defaultBranchPath(projectId: string, location: string, productId: string): string {
  return buildDefaultBranchPath({
    projectId,
    location,
    ...buildRagResourceIds(productId),
  });
}

/** Build the Cloud Storage object path a product document is stored under. */
export function buildGcsObjectPath(productId: string, documentId: string, sanitizedFileName: string): string {
  return `products/${productId}/${documentId}-${sanitizedFileName}`;
}

/** Build the gs:// URI Discovery Engine imports a document from. */
export function buildGcsUri(bucketName: string, objectPath: string): string {
  return `gs://${bucketName}/${objectPath}`;
}

/** Build the Cloud Storage object-key prefix that holds every document of a product. */
export function buildProductObjectPrefix(productId: string): string {
  return `products/${productId}/`;
}

/** Normalize a product id into the Discovery Engine identifier character allowlist. */
function normalizeProductId(productId: string): string {
  const safeProductId = productId
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (safeProductId === "") {
    throw new Error("Unable to derive a Discovery Engine resource id from the product id.");
  }

  return safeProductId;
}
