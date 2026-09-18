import type { Readable } from "node:stream";

import Busboy from "busboy";
import type { Request } from "express";

import { badRequest } from "../errors";

export interface ParsedUpload {
  readonly contentType: string;
  readonly fileName: string;
  readonly stream: Readable;
}

export interface ParseSingleFileUploadOptions {
  readonly allowedContentTypes: ReadonlySet<string>;
  readonly maxSizeBytes: number;
}

/** Raised on the returned file stream when the upload exceeds the configured size limit. */
export class FileSizeLimitExceededError extends Error {
  public constructor() {
    super("FILE_SIZE_LIMIT_EXCEEDED");
    this.name = "FileSizeLimitExceededError";
  }
}

/** Parse a `multipart/form-data` request that must contain exactly one `file` field. */
export function parseSingleFileUpload(request: Request, options: ParseSingleFileUploadOptions): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fileSeen = false;

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    let busboyInstance: ReturnType<typeof Busboy>;
    try {
      busboyInstance = Busboy({
        headers: request.headers,
        limits: { fields: 0, files: 1, fileSize: options.maxSizeBytes },
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? badRequest() : error);
      return;
    }

    busboyInstance.on("file", (_name, stream, info) => {
      if (fileSeen || !options.allowedContentTypes.has(info.mimeType)) {
        stream.resume();
        settleReject(badRequest());
        return;
      }

      fileSeen = true;
      stream.on("limit", () => {
        stream.destroy(new FileSizeLimitExceededError());
      });

      settled = true;
      resolve({ contentType: info.mimeType, fileName: info.filename, stream });
    });

    busboyInstance.on("field", () => {
      settleReject(badRequest());
    });

    busboyInstance.on("filesLimit", () => {
      settleReject(badRequest());
    });

    busboyInstance.on("error", () => {
      settleReject(badRequest());
    });

    busboyInstance.on("close", () => {
      if (!fileSeen) {
        settleReject(badRequest());
      }
    });

    request.pipe(busboyInstance);
  });
}
