/**
 * Consulta360Component — vista del feature Consulta Cliente 360 (frontend).
 *
 * Componente standalone Angular 20, `OnPush`. Presenta un formulario reactivo
 * (Tipo_Documento y Numero_Documento) y un área de resultados dispuesta lado a
 * lado. No contiene lógica de negocio ni credenciales: delega la consulta en
 * `ConsultaClienteService`, que solo llama al backend propio (patrón BFF).
 *
 * Responsabilidades de la vista:
 * - Capturar y validar la entrada en el cliente (dígitos, longitud 1–15). (Req 1.1–1.7)
 * - Habilitar el botón "Enviar" solo con formulario válido y sin consulta en curso. (Req 1.7, 2.5)
 * - Mapear el `ConsultaResult` del servicio a un estado de vista discriminado
 *   (`idle`/`loading`/`success`/`noData`/`error`). (Req 2.2–2.7)
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { ConsultaClienteService } from './consulta-cliente.service';
import type {
  ClienteResponseDTO,
  ConsultaRequest,
  ConsultaResult,
  ViewState,
} from './consulta360-models';

/** Patrón de validación del Numero_Documento: solo dígitos, longitud 1–15. (Req 1.2, 1.4, 1.5, 1.6) */
const NUMERO_DOCUMENTO_PATTERN = /^[0-9]{1,15}$/;

/** Texto mostrado por cada campo ausente o vacío en el resultado. (Req 2.3) */
const NO_DISPONIBLE = 'No disponible';

@Component({
  selector: 'app-consulta360',
  imports: [ReactiveFormsModule],
  templateUrl: './consulta360.html',
  styleUrl: './consulta360.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Consulta360Component {
  private readonly fb = inject(FormBuilder);
  private readonly consultaService = inject(ConsultaClienteService);

  /** Texto constante para campos no disponibles, expuesto a la plantilla. */
  protected readonly noDisponible = NO_DISPONIBLE;

  /**
   * Formulario reactivo de la consulta. `tipoDocumento` fija `CC` como único
   * valor; `numeroDocumento` acepta solo dígitos con longitud 1–15. (Req 1.1, 1.2)
   */
  protected readonly form = this.fb.nonNullable.group({
    tipoDocumento: this.fb.nonNullable.control<'CC'>('CC', [Validators.required]),
    numeroDocumento: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(NUMERO_DOCUMENTO_PATTERN),
    ]),
  });

  /** Estado actual de la vista de resultados. (Req 2.4, 2.5, 2.6, 2.7) */
  protected readonly state = signal<ViewState>('idle');

  /** Datos del cliente cuando el estado es `success`; `null` en cualquier otro estado. */
  protected readonly cliente = signal<ClienteResponseDTO | null>(null);

  /** Control tipado del Numero_Documento, para consultar su validez en la plantilla. */
  protected get numeroDocumentoControl() {
    return this.form.controls.numeroDocumento;
  }

  /** `true` si el campo tiene contenido que no coincide con el patrón de solo dígitos. (Req 1.4) */
  protected get hasPatternError(): boolean {
    const control = this.numeroDocumentoControl;
    return control.hasError('pattern') && (control.dirty || control.touched);
  }

  /** `true` si el campo está vacío tras haber sido tocado. (Req 1.6) */
  protected get hasRequiredError(): boolean {
    const control = this.numeroDocumentoControl;
    return control.hasError('required') && (control.dirty || control.touched);
  }

  /**
   * Envía la consulta al backend propio con la entrada validada.
   *
   * Convierte la cadena de dígitos a `number` antes de enviar (Req 2.2) y mapea
   * el `ConsultaResult` emitido por el servicio al estado de vista. Ignora el
   * envío si el formulario es inválido (defensa adicional al `[disabled]`).
   */
  protected onSubmit(): void {
    if (this.form.invalid) {
      return;
    }

    const { tipoDocumento, numeroDocumento } = this.form.getRawValue();
    const request: ConsultaRequest = {
      tipoDocumento,
      numeroDocumento: Number(numeroDocumento),
    };

    this.state.set('loading');
    this.cliente.set(null);

    this.consultaService.consultar(request).subscribe((result: ConsultaResult) => {
      this.applyResult(result);
    });
  }

  /**
   * Mapea el resultado tipado del servicio al estado de vista y a los datos
   * del cliente cuando corresponde. (Req 2.2, 2.4, 2.7)
   *
   * @param result resultado normalizado emitido por `ConsultaClienteService`.
   */
  private applyResult(result: ConsultaResult): void {
    switch (result.kind) {
      case 'success':
        this.cliente.set(result.cliente);
        this.state.set('success');
        break;
      case 'noData':
        this.cliente.set(null);
        this.state.set('noData');
        break;
      case 'error':
        this.cliente.set(null);
        this.state.set('error');
        break;
    }
  }
}
