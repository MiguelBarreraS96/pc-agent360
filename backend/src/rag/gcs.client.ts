import { Storage, type Bucket } from "@google-cloud/storage";

/** Create the Cloud Storage client, authenticated via Cloud Run Application Default Credentials. */
export function createRagStorageClient(): Storage {
  return new Storage();
}

/** Return the configured RAG bucket, creating it once if it does not exist yet. */
export async function ensureRagBucket(storage: Storage, bucketName: string, location: string): Promise<Bucket> {
  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  if (!exists) {
    await storage.createBucket(bucketName, {
      location,
      storageClass: "STANDARD",
      uniformBucketLevelAccess: true,
    });
  }

  return bucket;
}
