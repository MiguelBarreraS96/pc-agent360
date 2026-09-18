import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { GeminiPreviewRequest, GeminiPreviewResponse } from './api.models';
import { RUNTIME_CONFIG, RuntimeConfig } from './runtime-config';

/** Calls the authenticated local-only backend route that verifies direct Gemini connectivity. */
@Injectable({ providedIn: 'root' })
export class GeminiPreviewApiService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject<RuntimeConfig>(RUNTIME_CONFIG);

  /** Send one bounded user question to the local Gemini connectivity probe. */
  async askQuestion(request: GeminiPreviewRequest): Promise<GeminiPreviewResponse> {
    return firstValueFrom(this.http.post<GeminiPreviewResponse>(this.endpoint('/development/gemini/chat'), request));
  }

  /** Build an endpoint from the validated backend base URL. */
  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }
}
