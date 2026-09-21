import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { AgentTurnResponse, FastActionDto } from './api.models';
import { RUNTIME_CONFIG, RuntimeConfig } from './runtime-config';

/** Calls the sales-assistant routes: Cliente 360 lookup, product selection, follow-up questions and fast actions. */
@Injectable({ providedIn: 'root' })
export class AgentApiService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject<RuntimeConfig>(RUNTIME_CONFIG);

  /** Start a conversation from the lead's document number; the backend keeps it out of any model prompt. */
  startSession(documentNumber: string): Promise<AgentTurnResponse> {
    return firstValueFrom(this.http.post<AgentTurnResponse>(this.endpoint('/agent/sessions'), { documentNumber }));
  }

  /** Choose one of the suggested products and receive its clausulado-backed brief and sales script. */
  selectProduct(sessionId: string, productId: string): Promise<AgentTurnResponse> {
    return firstValueFrom(
      this.http.post<AgentTurnResponse>(this.endpoint(`/agent/sessions/${sessionId}/product`), { productId }),
    );
  }

  /** Ask a free-text question about the product or about how to handle the lead. */
  sendMessage(sessionId: string, text: string): Promise<AgentTurnResponse> {
    return firstValueFrom(
      this.http.post<AgentTurnResponse>(this.endpoint(`/agent/sessions/${sessionId}/messages`), { text }),
    );
  }

  /** Trigger one predefined mid-call helper (objection, call problem, common product question). */
  runFastAction(sessionId: string, actionId: string): Promise<AgentTurnResponse> {
    return firstValueFrom(
      this.http.post<AgentTurnResponse>(this.endpoint(`/agent/sessions/${sessionId}/fast-actions`), { actionId }),
    );
  }

  async listFastActions(): Promise<readonly FastActionDto[]> {
    const response = await firstValueFrom(
      this.http.get<{ readonly fastActions: readonly FastActionDto[] }>(this.endpoint('/agent/fast-actions')),
    );
    return response.fastActions;
  }

  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }
}
