import { ChangeDetectionStrategy, Component, ElementRef, OnChanges, OnDestroy, SimpleChanges, inject, input, output, signal, viewChild } from '@angular/core';

import { ApiErrorService } from '../../core/api-error.service';
import { ProductDocumentDto, ProductDocumentStatus, ProductDto } from '../../core/api.models';
import { ProductsApiService } from '../../core/products-api.service';

const POLL_INTERVAL_MILLISECONDS = 10_000;
const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const DOCUMENT_STATUS_LABELS: Readonly<Record<ProductDocumentStatus, string>> = {
  indexing: 'Indexando',
  indexed: 'Indexado',
  error: 'Error',
};

const DOCUMENT_STATUS_STYLES: Readonly<Record<ProductDocumentStatus, { background: string; color: string }>> = {
  indexing: { background: 'rgba(255,209,0,.16)', color: '#8a6d00' },
  indexed: { background: 'rgba(0,169,79,.10)', color: '#00803b' },
  error: { background: 'rgba(239,68,68,.12)', color: '#b91c1c' },
};

/** Manage a single product's RAG knowledge base: engine status polling, document upload, list and delete. */
@Component({
  selector: 'app-product-documents',
  templateUrl: './product-documents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDocumentsComponent implements OnChanges, OnDestroy {
  private readonly apiErrors = inject(ApiErrorService);
  private readonly productsApi = inject(ProductsApiService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly product = input.required<ProductDto>();
  readonly closed = output<void>();
  readonly productChanged = output<ProductDto>();

  readonly documents = signal<readonly ProductDocumentDto[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isUploading = signal(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private loadedProductId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if ('product' in changes && this.product().id !== this.loadedProductId) {
      this.loadedProductId = this.product().id;
      void this.reload();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /** Close the manager. */
  close(): void {
    this.closed.emit();
  }

  /** Label for a document's indexing status. */
  statusLabel(status: ProductDocumentStatus): string {
    return DOCUMENT_STATUS_LABELS[status];
  }

  /** Chip background/text color pair for a document's indexing status. */
  statusStyle(status: ProductDocumentStatus): { background: string; color: string } {
    return DOCUMENT_STATUS_STYLES[status];
  }

  /** Open the native file picker. */
  pickFile(): void {
    this.fileInput()?.nativeElement.click();
  }

  /** Format a byte count as a short human-readable size. */
  formatSize(sizeBytes: number): string {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }

    const kilobytes = sizeBytes / 1024;
    if (kilobytes < 1024) {
      return `${kilobytes.toFixed(1)} KB`;
    }

    return `${(kilobytes / 1024).toFixed(1)} MB`;
  }

  /** Upload the file selected from the native picker. */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) {
      return;
    }

    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      this.errorMessage.set('Solo se aceptan archivos PDF, DOC, DOCX o TXT.');
      this.errorSupportId.set(null);
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      this.errorMessage.set('El archivo supera el tamaño máximo permitido de 50 MB.');
      this.errorSupportId.set(null);
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isUploading.set(true);

    try {
      await this.productsApi.uploadDocument(this.product().id, file);
      await this.reload();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isUploading.set(false);
    }
  }

  /** Delete a document after explicit confirmation. */
  async deleteDocument(document: ProductDocumentDto): Promise<void> {
    if (!window.confirm(`¿Desea eliminar "${document.fileName}" del motor de búsqueda?`)) {
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);

    try {
      await this.productsApi.deleteDocument(this.product().id, document.id);
      await this.reload();
    } catch (error: unknown) {
      this.showError(error);
    }
  }

  /** Reload the product's reconciled RAG state and document list, then decide whether to keep polling. */
  private async reload(): Promise<void> {
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isLoading.set(true);

    try {
      const [product, documents] = await Promise.all([
        this.productsApi.getProduct(this.product().id),
        this.productsApi.listDocuments(this.product().id),
      ]);
      this.documents.set(documents);
      this.productChanged.emit(product);

      const stillSettling = product.rag.state === 'creating' || documents.some((document) => document.status === 'indexing');
      if (stillSettling) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private startPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    this.pollTimer = setInterval(() => void this.reload(), POLL_INTERVAL_MILLISECONDS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Show a generic API error and optional safe support identifier. */
  private showError(error: unknown): void {
    this.errorMessage.set(this.apiErrors.messageFor(error));
    this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
  }
}
