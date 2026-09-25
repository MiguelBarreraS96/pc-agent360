import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ConsultationsExportFormat, ConsultationsSummaryDto } from './api.models';
import { RUNTIME_CONFIG, RuntimeConfig } from './runtime-config';

const CONTENT_DISPOSITION_FILENAME_PATTERN = /filename="?([^";]+)"?/i;

export interface ConsultationsDownload {
  readonly blob: Blob;
  readonly filename: string;
}

/** Provides typed calls to the ADMIN Cliente 360 consultations report, mirroring products-api.service patterns. */
@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject<RuntimeConfig>(RUNTIME_CONFIG);

  /** Fetch consultation totals (all, unique documents, found/not found) for an inclusive Bogotá date range. */
  async getSummary(desde: string, hasta: string): Promise<ConsultationsSummaryDto> {
    const params = new HttpParams().set('desde', desde).set('hasta', hasta);
    return firstValueFrom(
      this.http.get<ConsultationsSummaryDto>(this.endpoint('/admin/reports/consultations/summary'), { params }),
    );
  }

  /** Download every consultation in the range as CSV or XML, reading the server-provided file name. */
  async download(desde: string, hasta: string, formato: ConsultationsExportFormat): Promise<ConsultationsDownload> {
    const params = new HttpParams().set('desde', desde).set('hasta', hasta).set('formato', formato);
    const response = await firstValueFrom(
      this.http.get(this.endpoint('/admin/reports/consultations/export'), {
        observe: 'response',
        params,
        responseType: 'blob',
      }),
    );

    return {
      blob: response.body ?? new Blob(),
      filename: this.filenameFrom(response.headers.get('Content-Disposition'), formato),
    };
  }

  /** Build endpoints from the validated backend base URL. */
  private endpoint(path: string): string {
    return `${this.runtimeConfig.apiBaseUrl}${path}`;
  }

  /** Read the server-provided download file name, falling back to a generic one if the header is missing. */
  private filenameFrom(contentDisposition: string | null, formato: ConsultationsExportFormat): string {
    const match = contentDisposition !== null ? CONTENT_DISPOSITION_FILENAME_PATTERN.exec(contentDisposition) : null;
    return match?.[1] ?? `consultas-cliente360.${formato}`;
  }
}
