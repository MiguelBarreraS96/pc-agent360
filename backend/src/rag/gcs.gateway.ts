import type { Readable } from "node:stream";

import type { Bucket, Storage } from "@google-cloud/storage";

import { ensureRagBucket } from "./gcs.client";
import { isNotFound, RagOperationError } from "./rag.errors";
import { buildGcsUri } from "./rag.ids";

export interface UploadResult {
  readonly sizeBytes: number;
}

/** Store and remove a product's source documents in the shared RAG Cloud Storage bucket. */
export class RagStorageGateway {
  private bucketPromise: Promise<Bucket> | null = null;

  public constructor(
    private readonly storage: Storage,
    private readonly bucketName: string,
    private readonly bucketLocation: string,
  ) {}

  /** Build the gs:// URI Discovery Engine reads a stored object from. */
  public buildUri(objectPath: string): string {
    return buildGcsUri(this.bucketName, objectPath);
  }

  /** Delete a single object, treating an already-missing object as success. */
  public async deleteObject(objectPath: string): Promise<void> {
    const bucket = await this.getBucket();
    try {
      await bucket.file(objectPath).delete();
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw new RagOperationError("DELETE_FAILED", error);
      }
    }
  }

  /** Delete every object stored under a product's prefix. */
  public async deleteObjectsByPrefix(prefix: string): Promise<void> {
    const bucket = await this.getBucket();
    try {
      await bucket.deleteFiles({ prefix, force: true });
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw new RagOperationError("DELETE_FAILED", error);
      }
    }
  }

  /** Stream a single object into the bucket, counting the bytes actually written. */
  public async uploadObjectFromStream(objectPath: string, source: Readable, contentType: string): Promise<UploadResult> {
    const bucket = await this.getBucket();
    const file = bucket.file(objectPath);
    let sizeBytes = 0;

    await new Promise<void>((resolve, reject) => {
      const writeStream = file.createWriteStream({ contentType, resumable: false });
      source.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });
      source.on("error", (error) => {
        writeStream.destroy(error);
      });
      writeStream.on("error", (error: unknown) => {
        void file.delete({ ignoreNotFound: true }).finally(() => reject(new RagOperationError("UNKNOWN", error)));
      });
      writeStream.on("finish", () => resolve());
      source.pipe(writeStream);
    });

    return { sizeBytes };
  }

  /** Resolve the shared RAG bucket, creating it once (memoized) the first time it is actually needed. */
  private getBucket(): Promise<Bucket> {
    this.bucketPromise ??= ensureRagBucket(this.storage, this.bucketName, this.bucketLocation).catch((error: unknown) => {
      this.bucketPromise = null;
      throw error;
    });
    return this.bucketPromise;
  }
}
