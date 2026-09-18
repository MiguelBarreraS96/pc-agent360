import { protos } from "@google-cloud/discoveryengine";

import type { DiscoveryEngineClients } from "./discovery-engine.client";
import { RagOperationError, isAlreadyExists, isNotFound } from "./rag.errors";
import {
  buildRagResourceIds,
  collectionPath,
  dataStorePath,
  defaultBranchPath,
  deriveDataStoreId,
  deriveEngineId,
  enginePath,
  servingConfigPath,
  type RagResource,
} from "./rag.ids";

const { ContentConfig } = protos.google.cloud.discoveryengine.v1.DataStore;
const { IndustryVertical, SearchAddOn, SearchTier, SolutionType } = protos.google.cloud.discoveryengine.v1;

type SearchResult = protos.google.cloud.discoveryengine.v1.SearchResponse.ISearchResult;
type Struct = protos.google.protobuf.IStruct;
type StructValue = protos.google.protobuf.IValue;

const SEARCH_LANGUAGE_CODE = "es-419";
const SEARCH_PAGE_SIZE = 8;
const SEARCH_TIMEOUT_MILLISECONDS = 8_000;
const MAX_EXTRACTIVE_ANSWER_COUNT = 3;
const MAX_EXTRACTIVE_SEGMENT_COUNT = 3;

export interface StartResourceCreationResult {
  readonly operationName: string | null;
}

export type RagEvidenceSourceType = "extractive_answer" | "extractive_segment" | "snippet";

export interface RagEvidenceItem {
  readonly content: string;
  readonly documentId: string | null;
  readonly documentTitle: string | null;
  readonly score: number | null;
  readonly sourceType: RagEvidenceSourceType;
}

export interface RagSearchResult {
  readonly items: readonly RagEvidenceItem[];
}

/** Orchestrate the Discovery Engine resources (DataStore, Engine, Documents) backing one product. */
export class DiscoveryEngineGateway {
  public constructor(
    private readonly clients: DiscoveryEngineClients,
    private readonly projectId: string,
    private readonly location: string,
  ) {}

  /** Build the exact project, location, and deterministic resource ids that back one product. */
  public buildRagResource(productId: string): RagResource {
    return {
      projectId: this.projectId,
      location: this.location,
      ...buildRagResourceIds(productId),
    };
  }

  /** Start creating the product's DataStore only when its deterministic resource does not already exist. */
  public async startDataStoreCreation(
    productId: string,
    displayName: string,
  ): Promise<StartResourceCreationResult> {
    if (await this.dataStoreExists(productId)) {
      return { operationName: null };
    }

    try {
      const [operation] = await this.clients.dataStoreServiceClient.createDataStore({
        parent: collectionPath(this.projectId, this.location),
        dataStoreId: deriveDataStoreId(productId),
        dataStore: {
          displayName,
          industryVertical: IndustryVertical.GENERIC,
          solutionTypes: [SolutionType.SOLUTION_TYPE_SEARCH],
          contentConfig: ContentConfig.CONTENT_REQUIRED,
        },
      });
      return { operationName: operation.name ?? null };
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        return { operationName: null };
      }

      throw new RagOperationError("DATASTORE_CREATE_FAILED", error);
    }
  }

  /** Check whether the product's DataStore has finished provisioning. */
  public async dataStoreExists(productId: string): Promise<boolean> {
    try {
      await this.clients.dataStoreServiceClient.getDataStore({
        name: dataStorePath(this.projectId, this.location, productId),
      });
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return false;
      }

      throw new RagOperationError("UNKNOWN", error);
    }
  }

  /** Start creating the product's Engine, tolerating a resource that already exists. */
  public async startEngineCreation(
    productId: string,
    displayName: string,
  ): Promise<StartResourceCreationResult> {
    try {
      const [operation] = await this.clients.engineServiceClient.createEngine({
        parent: collectionPath(this.projectId, this.location),
        engineId: deriveEngineId(productId),
        engine: {
          displayName,
          dataStoreIds: [deriveDataStoreId(productId)],
          solutionType: SolutionType.SOLUTION_TYPE_SEARCH,
          industryVertical: IndustryVertical.GENERIC,
          searchEngineConfig: {
            searchTier: SearchTier.SEARCH_TIER_ENTERPRISE,
            searchAddOns: [SearchAddOn.SEARCH_ADD_ON_LLM],
          },
        },
      });
      return { operationName: operation.name ?? null };
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        return { operationName: null };
      }

      throw new RagOperationError("ENGINE_CREATE_FAILED", error);
    }
  }

  /** Check whether the product's Engine has finished provisioning. */
  public async engineExists(productId: string): Promise<boolean> {
    try {
      await this.clients.engineServiceClient.getEngine({
        name: enginePath(this.projectId, this.location, productId),
      });
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return false;
      }

      throw new RagOperationError("UNKNOWN", error);
    }
  }

  /** Delete the product's Engine, treating an already-missing resource as success. */
  public async deleteEngine(productId: string): Promise<void> {
    try {
      await this.clients.engineServiceClient.deleteEngine({
        name: enginePath(this.projectId, this.location, productId),
      });
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw new RagOperationError("DELETE_FAILED", error);
      }
    }
  }

  /** Delete the product's DataStore, treating an already-missing resource as success. */
  public async deleteDataStore(productId: string): Promise<void> {
    try {
      await this.clients.dataStoreServiceClient.deleteDataStore({
        name: dataStorePath(this.projectId, this.location, productId),
      });
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw new RagOperationError("DELETE_FAILED", error);
      }
    }
  }

  /** Start an incremental import of a single document without waiting for it to finish. */
  public async importDocument(productId: string, gcsUri: string): Promise<void> {
    try {
      await this.clients.documentServiceClient.importDocuments({
        parent: defaultBranchPath(this.projectId, this.location, productId),
        gcsSource: {
          inputUris: [gcsUri],
          dataSchema: "content",
        },
        reconciliationMode: "INCREMENTAL",
      });
    } catch (error: unknown) {
      throw new RagOperationError("IMPORT_FAILED", error);
    }
  }

  /** Find the engine-side document id whose stored content URI matches a Cloud Storage object. */
  public async findEngineDocumentIdByUri(productId: string, gcsUri: string): Promise<string | null> {
    try {
      const documents = this.clients.documentServiceClient.listDocumentsAsync({
        parent: defaultBranchPath(this.projectId, this.location, productId),
      });
      for await (const document of documents) {
        if (document.content?.uri === gcsUri && document.id !== null && document.id !== undefined) {
          return document.id;
        }
      }

      return null;
    } catch (error: unknown) {
      throw new RagOperationError("UNKNOWN", error);
    }
  }

  /** Delete a single engine-side document, treating an already-missing resource as success. */
  public async deleteEngineDocument(productId: string, engineDocumentId: string): Promise<void> {
    try {
      await this.clients.documentServiceClient.deleteDocument({
        name: `${defaultBranchPath(this.projectId, this.location, productId)}/documents/${engineDocumentId}`,
      });
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw new RagOperationError("DELETE_FAILED", error);
      }
    }
  }

  /** Probe one active product engine with the bounded retrieval configuration used by the mini agent. */
  public async probe(productId: string, input: RagProbeInput): Promise<RagProbeResponse> {
    try {
      const [results, , response] = await this.clients.searchServiceClient.search(
        {
          contentSearchSpec: {
            extractiveContentSpec: {
              maxExtractiveAnswerCount: 1,
              maxExtractiveSegmentCount: 2,
              numNextSegments: 1,
              numPreviousSegments: 1,
              returnExtractiveSegmentScore: true,
            },
            snippetSpec: {
              maxSnippetCount: 3,
              returnSnippet: true,
            },
            summarySpec: {
              includeCitations: true,
              summaryResultCount: Math.min(input.pageSize, 3),
            },
          },
          languageCode: SEARCH_LANGUAGE_CODE,
          pageSize: input.pageSize,
          query: input.query,
          servingConfig: servingConfigPath(this.projectId, this.location, productId),
        },
        { autoPaginate: false, timeout: SEARCH_TIMEOUT_MILLISECONDS },
      );

      return {
        query: input.query,
        results: results.map(toRagProbeResult),
        summary: readProbeSummary(response),
      };
    } catch (error: unknown) {
      throw new RagOperationError("SEARCH_FAILED", error);
    }
  }

  /** Search a product's Engine for grounding evidence: extractive segments, extractive answers, and snippets. */
  public async search(productId: string, query: string): Promise<RagSearchResult> {
    try {
      const [results] = await this.clients.searchServiceClient.search(
        {
          contentSearchSpec: {
            extractiveContentSpec: {
              maxExtractiveAnswerCount: MAX_EXTRACTIVE_ANSWER_COUNT,
              maxExtractiveSegmentCount: MAX_EXTRACTIVE_SEGMENT_COUNT,
              returnExtractiveSegmentScore: true,
            },
            snippetSpec: { returnSnippet: true },
          },
          languageCode: SEARCH_LANGUAGE_CODE,
          pageSize: SEARCH_PAGE_SIZE,
          query,
          servingConfig: servingConfigPath(this.projectId, this.location, productId),
        },
        { autoPaginate: false, timeout: SEARCH_TIMEOUT_MILLISECONDS },
      );

      return { items: results.flatMap((result) => extractEvidenceFromResult(result)) };
    } catch (error: unknown) {
      throw new RagOperationError("SEARCH_FAILED", error);
    }
  }
}

export interface RagProbeInput {
  readonly pageSize: number;
  readonly query: string;
}

export interface RagProbeResult {
  readonly id: string | null;
  readonly link: string | null;
  readonly snippet: string | null;
  readonly title: string | null;
}

export interface RagProbeResponse {
  readonly query: string;
  readonly results: readonly RagProbeResult[];
  readonly summary: string | null;
}

/** Build one probe result with content ordered by extractive answer, segment, and then snippet. */
function toRagProbeResult(result: SearchResult): RagProbeResult {
  const derived = structToRecord(result.document?.derivedStructData ?? null);
  const extractiveAnswer = readFirstContent(asRecordArray(derived.extractive_answers), "content");
  const extractiveSegment = readScoredSegment(asRecordArray(derived.extractive_segments));
  const snippet = readFirstContent(asRecordArray(derived.snippets), "snippet");

  return {
    id: toNullableString(result.id),
    link: toNullableString(result.document?.content?.uri),
    snippet: extractiveAnswer ?? extractiveSegment ?? snippet,
    title: readStringField(derived, "title"),
  };
}

/** Select the first non-empty content field from an ordered evidence collection. */
function readFirstContent(records: readonly Record<string, unknown>[], contentKey: string): string | null {
  for (const record of records) {
    const content = readStringField(record, contentKey);
    if (content !== null) {
      return content;
    }
  }

  return null;
}

/** Select the first extractive segment whose relevance score is greater than the required threshold. */
function readScoredSegment(records: readonly Record<string, unknown>[]): string | null {
  for (const record of records) {
    const score = readNumberField(record, "relevanceScore", "relevance_score");
    const content = readStringField(record, "content");
    if (score !== null && score > 0.5 && content !== null) {
      return content;
    }
  }

  return null;
}

/** Read the optional generated summary without serializing the provider response into logs or clients. */
function readProbeSummary(response: unknown): string | null {
  if (!isRecord(response) || !isRecord(response.summary)) {
    return null;
  }

  return toNullableString(response.summary.summaryText);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pull evidence candidates (extractive segments, extractive answers, snippets) out of one raw search result. */
function extractEvidenceFromResult(result: SearchResult): RagEvidenceItem[] {
  const derived = structToRecord(result.document?.derivedStructData ?? null);
  const documentId = typeof result.id === "string" && result.id !== "" ? result.id : null;
  const documentTitle = readStringField(derived, "title");

  const segments = asRecordArray(derived.extractive_segments)
    .map((segment) =>
      toEvidenceItem(segment, "extractive_segment", documentId, documentTitle, "content", [
        "relevanceScore",
        "relevance_score",
      ]),
    )
    .filter((item): item is RagEvidenceItem => item !== null);

  const answers = asRecordArray(derived.extractive_answers)
    .map((answer) => toEvidenceItem(answer, "extractive_answer", documentId, documentTitle, "content", []))
    .filter((item): item is RagEvidenceItem => item !== null);

  const snippets = asRecordArray(derived.snippets)
    .map((snippet) => toEvidenceItem(snippet, "snippet", documentId, documentTitle, "snippet", []))
    .filter((item): item is RagEvidenceItem => item !== null);

  return [...segments, ...answers, ...snippets];
}

/** Build one evidence item from a decoded derivedStructData entry, or null when it carries no usable content. */
function toEvidenceItem(
  record: Record<string, unknown>,
  sourceType: RagEvidenceSourceType,
  documentId: string | null,
  documentTitle: string | null,
  contentKey: string,
  scoreKeys: readonly string[],
): RagEvidenceItem | null {
  const content = readStringField(record, contentKey);
  if (content === null) {
    return null;
  }

  return {
    content,
    documentId,
    documentTitle,
    score: readNumberField(record, ...scoreKeys),
    sourceType,
  };
}

/** Convert a `google.protobuf.Struct` (Discovery Engine's `derivedStructData`) into a plain JS record. */
function structToRecord(struct: Struct | null | undefined): Record<string, unknown> {
  const fields = struct?.fields;
  if (fields === null || fields === undefined) {
    return {};
  }

  const record: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    record[key] = valueToPlain(fields[key]);
  }

  return record;
}

/** Convert a single `google.protobuf.Value` (a oneof of exactly one populated kind) into a plain JS value. */
function valueToPlain(value: StructValue | null | undefined): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value.stringValue !== null && value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.numberValue !== null && value.numberValue !== undefined) {
    return value.numberValue;
  }
  if (value.boolValue !== null && value.boolValue !== undefined) {
    return value.boolValue;
  }
  if (value.structValue !== null && value.structValue !== undefined) {
    return structToRecord(value.structValue);
  }
  if (value.listValue?.values !== null && value.listValue?.values !== undefined) {
    return value.listValue.values.map(valueToPlain);
  }

  return null;
}

/** Narrow a decoded struct field into an array of plain records, discarding anything else. */
function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

/** Read the first non-empty string among the given keys of a decoded struct record. */
function readStringField(record: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

/** Read the first finite number among the given keys of a decoded struct record. */
function readNumberField(record: Record<string, unknown>, ...keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}
