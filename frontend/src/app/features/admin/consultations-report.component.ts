import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';

import { ApiErrorService } from '../../core/api-error.service';
import { ConsultationsExportFormat, ConsultationsSummaryDto } from '../../core/api.models';
import { ReportsApiService } from '../../core/reports-api.service';

const MAX_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

interface ConsultedRange {
  readonly desde: string;
  readonly hasta: string;
}

/** Admin report over Cliente 360 consultations recorded in agentSessions: a date-range summary plus CSV/XML export. */
@Component({
  selector: 'app-consultations-report',
  imports: [ReactiveFormsModule],
  templateUrl: './consultations-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsultationsReportComponent implements OnDestroy {
  private readonly apiErrors = inject(ApiErrorService);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly reportsApi = inject(ReportsApiService);

  readonly today = this.todayIsoDate();
  readonly downloadingFormat = signal<ConsultationsExportFormat | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly queriedRange = signal<ConsultedRange | null>(null);
  readonly summary = signal<ConsultationsSummaryDto | null>(null);
  readonly validationMessage = signal<string | null>(null);

  readonly hasNoResults = computed(() => this.summary() !== null && this.summary()?.totalConsultas === 0);
  readonly rangeLabel = computed(() => {
    const range = this.queriedRange();
    return range === null ? '' : `Del ${this.formatSpanishDate(range.desde)} al ${this.formatSpanishDate(range.hasta)} (hora Colombia)`;
  });

  readonly form = this.formBuilder.group({
    desde: this.formBuilder.control(this.firstDayOfCurrentMonth()),
    hasta: this.formBuilder.control(this.today),
  });

  private readonly clearSummaryOnEdit = this.form.valueChanges.subscribe(() => {
    this.summary.set(null);
    this.queriedRange.set(null);
  });

  ngOnDestroy(): void {
    this.clearSummaryOnEdit.unsubscribe();
  }

  /** Validate the selected range client-side and fetch the summary; the download buttons then use this same range. */
  async consult(): Promise<void> {
    this.errorMessage.set(null);
    this.validationMessage.set(null);

    const desde = this.form.controls.desde.value;
    const hasta = this.form.controls.hasta.value;
    const validationError = this.validateRange(desde, hasta);
    if (validationError !== null) {
      this.validationMessage.set(validationError);
      return;
    }

    this.isLoading.set(true);
    this.summary.set(null);
    this.queriedRange.set(null);

    try {
      const summary = await this.reportsApi.getSummary(desde, hasta);
      this.summary.set(summary);
      this.queriedRange.set({ desde, hasta });
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Download the consultations of the currently displayed summary's range as CSV. */
  async downloadCsv(): Promise<void> {
    await this.download('csv');
  }

  /** Download the consultations of the currently displayed summary's range as XML. */
  async downloadXml(): Promise<void> {
    await this.download('xml');
  }

  /** Fetch and save one export format for the exact range behind the visible summary card. */
  private async download(formato: ConsultationsExportFormat): Promise<void> {
    const range = this.queriedRange();
    if (range === null || this.downloadingFormat() !== null) {
      return;
    }

    this.errorMessage.set(null);
    this.downloadingFormat.set(formato);

    try {
      const { blob, filename } = await this.reportsApi.download(range.desde, range.hasta, formato);
      this.saveBlob(blob, filename);
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.downloadingFormat.set(null);
    }
  }

  /** Trigger a browser download for an in-memory blob without navigating away from the report. */
  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    try {
      const link = this.document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Apply the client-side rules mirrored from the backend: required, ordered, not in the future, at most 366 days. */
  private validateRange(desde: string, hasta: string): string | null {
    if (desde === '' || hasta === '') {
      return 'Ingrese la fecha de inicio y la fecha de fin.';
    }

    if (desde > hasta) {
      return 'La fecha de inicio debe ser igual o anterior a la fecha de fin.';
    }

    if (hasta > this.today) {
      return 'La fecha de fin no puede ser posterior a hoy.';
    }

    if (this.inclusiveDaysBetween(desde, hasta) > MAX_RANGE_DAYS) {
      return 'El rango no puede superar 366 días; reduzca el rango.';
    }

    return null;
  }

  /** Number of calendar days between two YYYY-MM-DD dates, both inclusive. */
  private inclusiveDaysBetween(desde: string, hasta: string): number {
    return Math.round((this.toUtcMidnight(hasta) - this.toUtcMidnight(desde)) / MILLISECONDS_PER_DAY) + 1;
  }

  private toUtcMidnight(value: string): number {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  /** Render a YYYY-MM-DD date as DD/MM/YYYY for the Spanish-language range label. */
  private formatSpanishDate(value: string): string {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }

  private firstDayOfCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  private todayIsoDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /** Show the fixed 422 message for an oversized range, or a generic failure for anything else. */
  private showError(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 422) {
      this.errorMessage.set('El rango tiene demasiadas consultas; reduce el rango.');
      return;
    }

    if (error instanceof HttpErrorResponse) {
      this.errorMessage.set(this.apiErrors.messageFor(error));
      return;
    }

    this.errorMessage.set('No fue posible generar el reporte.');
  }
}
