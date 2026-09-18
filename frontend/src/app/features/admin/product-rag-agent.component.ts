import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ApiErrorService } from '../../core/api-error.service';
import { ProductDto, ProductRagAgentResponse } from '../../core/api.models';
import { nonBlankValidator } from '../../core/input-normalization';
import { ProductsApiService } from '../../core/products-api.service';

const MAX_QUERY_LENGTH = 1_000;

/** Test one active product RAG engine and display the evidence Gemini used for its grounded answer. */
@Component({
  selector: 'app-product-rag-agent',
  imports: [ReactiveFormsModule],
  templateUrl: './product-rag-agent.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRagAgentComponent {
  private readonly apiErrors = inject(ApiErrorService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly productsApi = inject(ProductsApiService);

  readonly product = input.required<ProductDto>();
  readonly closed = output<void>();
  readonly errorMessage = signal<string | null>(null);
  readonly errorSupportId = signal<string | null>(null);
  readonly isAsking = signal(false);
  readonly result = signal<ProductRagAgentResponse | null>(null);

  readonly form = this.formBuilder.group({
    query: this.formBuilder.control('', [Validators.required, Validators.maxLength(MAX_QUERY_LENGTH), nonBlankValidator]),
  });

  /** Close the mini agent. */
  close(): void {
    this.closed.emit();
  }

  /** Close the mini agent when Escape is pressed. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  /** Run the strict RAG probe followed by Gemini only when evidence is available. */
  async ask(): Promise<void> {
    if (this.form.invalid || this.product().rag.state !== 'active') {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.errorSupportId.set(null);
    this.isAsking.set(true);

    try {
      const query = this.form.controls.query.value.normalize('NFKC').trim();
      this.result.set(await this.productsApi.askProductRag(this.product().id, { query }));
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.isAsking.set(false);
    }
  }

  /** Show a generic API error and its optional safe support identifier. */
  private showError(error: unknown): void {
    this.errorMessage.set(this.apiErrors.messageFor(error));
    this.errorSupportId.set(this.apiErrors.correlationIdFor(error));
  }
}
