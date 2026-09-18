import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ApiErrorService } from '../../core/api-error.service';
import { CreateProductRequest, ProductDto, ProductRagState, UpdateProductRequest } from '../../core/api.models';
import { IconPickerComponent } from '../../core/icon-picker.component';
import { nonBlankValidator } from '../../core/input-normalization';
import { ProductsApiService } from '../../core/products-api.service';
import { ProductDocumentsComponent } from './product-documents.component';
import { ProductRagAgentComponent } from './product-rag-agent.component';

const RAG_STATE_LABELS: Readonly<Record<ProductRagState, string>> = {
  none: 'Sin motor',
  creating: 'Aprovisionando',
  active: 'Activo',
  error: 'Error',
};

const RAG_STATE_STYLES: Readonly<Record<ProductRagState, { background: string; color: string }>> = {
  none: { background: 'rgba(15,23,42,.08)', color: '#475569' },
  creating: { background: 'rgba(255,209,0,.16)', color: '#8a6d00' },
  active: { background: 'rgba(0,169,79,.10)', color: '#00803b' },
  error: { background: 'rgba(239,68,68,.12)', color: '#b91c1c' },
};

@Component({
  selector: 'app-products',
  imports: [ReactiveFormsModule, IconPickerComponent, ProductDocumentsComponent, ProductRagAgentComponent],
  templateUrl: './products.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsComponent implements OnInit {
  private readonly apiErrors = inject(ApiErrorService);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly productsApi = inject(ProductsApiService);

  readonly agentProduct = signal<ProductDto | null>(null);
  readonly documentsProduct = signal<ProductDto | null>(null);
  readonly editingProduct = signal<ProductDto | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isModalOpen = signal(false);
  readonly isSaving = signal(false);
  readonly listErrorMessage = signal<string | null>(null);
  readonly listErrorSupportId = signal<string | null>(null);
  readonly products = signal<readonly ProductDto[]>([]);

  private readonly lockBodyScroll = effect(() => {
    this.document.body.style.overflow = this.isModalOpen() || this.documentsProduct() !== null || this.agentProduct() !== null ? 'hidden' : '';
  });

  readonly form = this.formBuilder.group({
    icon: this.formBuilder.control('', [Validators.required, Validators.maxLength(80), nonBlankValidator]),
    name: this.formBuilder.control('', [Validators.required, Validators.maxLength(120), nonBlankValidator]),
  });

  ngOnInit(): void {
    void this.reload();
  }

  /** Load every product from the backend. */
  async reload(): Promise<void> {
    this.listErrorMessage.set(null);
    this.listErrorSupportId.set(null);
    this.isLoading.set(true);

    try {
      this.products.set(await this.productsApi.listProducts());
    } catch (error: unknown) {
      this.listErrorMessage.set(this.apiErrors.messageFor(error));
      this.listErrorSupportId.set(this.apiErrors.correlationIdFor(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Human-readable Spanish label for a product's RAG engine state. */
  ragStateLabel(state: ProductRagState): string {
    return RAG_STATE_LABELS[state];
  }

  /** Chip background/text color pair for a product's RAG engine state. */
  ragStateStyle(state: ProductRagState): { background: string; color: string } {
    return RAG_STATE_STYLES[state];
  }

  /** Close the create/edit modal without discarding the last saved state. */
  closeModal(): void {
    this.isModalOpen.set(false);
  }

  /** Close whichever modal is open when the user presses Escape anywhere on the page. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.agentProduct() !== null) {
      this.closeAgent();
      return;
    }

    if (this.documentsProduct() !== null) {
      this.closeDocuments();
      return;
    }

    if (this.isModalOpen()) {
      this.closeModal();
    }
  }

  /** Open the modal with a blank form for a new product. */
  openCreateModal(): void {
    this.prepareCreate();
    this.isModalOpen.set(true);
  }

  /** Open the modal populated with one existing product for a subsequent PATCH request. */
  openEditModal(product: ProductDto): void {
    this.prepareEdit(product);
    this.isModalOpen.set(true);
  }

  /** Open the product-specific RAG agent only after its search engine is active. */
  openAgent(product: ProductDto): void {
    if (product.rag.state === 'active') {
      this.agentProduct.set(product);
    }
  }

  /** Close the product-specific RAG agent. */
  closeAgent(): void {
    this.agentProduct.set(null);
  }

  /** Open the RAG knowledge base manager for one product. */
  openDocuments(product: ProductDto): void {
    this.documentsProduct.set(product);
  }

  /** Close the RAG knowledge base manager. */
  closeDocuments(): void {
    this.documentsProduct.set(null);
  }

  /** Refresh the product list after the knowledge base manager reports a state change. */
  onDocumentsProductChanged(product: ProductDto): void {
    this.documentsProduct.set(product);
    this.products.set(this.products().map((existing) => (existing.id === product.id ? product : existing)));
  }

  /** Reset the form for a new product creation request. */
  prepareCreate(): void {
    this.editingProduct.set(null);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.reset({ icon: '', name: '' });
  }

  /** Populate the form with one existing product for a subsequent PATCH request. */
  prepareEdit(product: ProductDto): void {
    this.editingProduct.set(product);
    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.form.reset({ icon: product.icon, name: product.name });
  }

  /** Create or update a product; creation also starts provisioning its RAG engine asynchronously. */
  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      const product = this.editingProduct();
      if (product === null) {
        await this.productsApi.createProduct(this.createRequest());
      } else {
        await this.productsApi.updateProduct(product.id, this.updateRequest());
      }

      this.prepareCreate();
      this.closeModal();
      await this.reload();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Delete a product and its RAG engine after explicit confirmation. */
  async deleteProduct(product: ProductDto): Promise<void> {
    if (!window.confirm(`¿Desea eliminar "${product.name}"? Esto también elimina su motor de búsqueda y documentos cargados.`)) {
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isSaving.set(true);

    try {
      await this.productsApi.deleteProduct(product.id);
      if (this.editingProduct()?.id === product.id) {
        this.prepareCreate();
        this.closeModal();
      }
      if (this.documentsProduct()?.id === product.id) {
        this.closeDocuments();
      }
      if (this.agentProduct()?.id === product.id) {
        this.closeAgent();
      }
      await this.reload();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Build the strict create payload from the current form state. */
  private createRequest(): CreateProductRequest {
    return {
      icon: this.form.controls.icon.value.normalize('NFKC').trim(),
      name: this.form.controls.name.value.normalize('NFKC').trim(),
    };
  }

  /** Build the strict update payload from the current form state. */
  private updateRequest(): UpdateProductRequest {
    return {
      icon: this.form.controls.icon.value.normalize('NFKC').trim(),
      name: this.form.controls.name.value.normalize('NFKC').trim(),
    };
  }

  /** Show a generic API error and optional safe support identifier. */
  private showError(error: unknown): void {
    this.errorMessage.set(this.apiErrors.messageFor(error));
    this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
  }
}
