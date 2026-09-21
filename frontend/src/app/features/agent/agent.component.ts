import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AgentApiService } from '../../core/agent-api.service';
import { SessionStateService } from '../../core/session-state.service';
import type {
  AgentBriefDto,
  AgentClientDto,
  AgentPropertyDto,
  AgentVehicleDto,
  AgentFactDto,
  AgentOutputDto,
  AgentProductDto,
  AgentProfileDto,
  AgentTurnResponse,
  FastActionDto,
  FastActionGroup,
} from '../../core/api.models';
import { nonBlankValidator } from '../../core/input-normalization';

type AgentStage = 'intro' | 'chat';
type MobileTab = 'chat' | 'panel';

interface ChatMessage {
  readonly id: number;
  readonly role: 'bot' | 'me';
  readonly sources: readonly string[];
  readonly text: string;
}

interface FactGroup {
  readonly facts: readonly AgentFactDto[];
  readonly label: string;
  readonly topic: string;
}

const CITIZEN_ID_PATTERN = /^\d{6,10}$/;
const MAX_QUESTION_LENGTH = 1_000;
const FAST_ACTION_GROUP_LABELS: Readonly<Record<FastActionGroup, string>> = {
  llamada: 'Llamada',
  objeciones: 'Objeciones',
  producto: 'Producto',
};
const FAST_ACTION_GROUP_ORDER: readonly FastActionGroup[] = ['producto', 'objeciones', 'llamada'];
const AGE_SEGMENT_LABELS: Readonly<Record<AgentProfileDto['ageSegment'], string>> = {
  adulto: 'Adulto',
  adulto_joven: 'Adulto joven',
  adulto_mayor: 'Adulto maduro',
  desconocido: 'Edad no disponible',
  joven: 'Joven',
  senior: 'Senior',
};
const APTITUDE_LABELS: Readonly<Record<keyof AgentProfileDto['aptitudes'], string>> = {
  autos: 'Autos',
  hogar: 'Hogar',
  salud: 'Salud',
  vida: 'Vida',
};
const FACT_TOPIC_ORDER: readonly string[] = [
  'coberturas',
  'beneficios',
  'exclusiones',
  'requisitos',
  'vigencia',
  'valor_y_pago',
  'reclamacion',
];
const FACT_TOPIC_LABELS: Readonly<Record<string, string>> = {
  beneficios: 'Beneficios',
  coberturas: 'Coberturas',
  exclusiones: 'Exclusiones',
  reclamacion: 'Reclamación',
  requisitos: 'Requisitos',
  valor_y_pago: 'Valor y pago',
  vigencia: 'Vigencia',
};

const LEAD_PLACEHOLDER = /\[\s*nombre del (?:lead|cliente)\s*\]/gi;
const ADVISOR_PLACEHOLDER = /\[\s*nombre del asesor\s*\]/gi;
const LOWERCASE_NAME_PARTS: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/** "MARIA DE LA LUZ" -> "Maria de la Luz"; anything empty becomes null. */
function toTitleCase(value: string | null | undefined): string | null {
  const words = (value ?? '').toLocaleLowerCase('es').split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return null;
  }

  return words
    .map((word, index) =>
      index > 0 && LOWERCASE_NAME_PARTS.has(word) ? word : word.charAt(0).toLocaleUpperCase('es') + word.slice(1),
    )
    .join(' ');
}

const NOT_FOUND_MESSAGE = 'No encontré información de Cliente 360 para esa cédula. Verifica el número e inténtalo de nuevo.';
const START_ERROR_MESSAGE = 'No fue posible consultar Cliente 360 en este momento. Inténtalo de nuevo en unos minutos.';
const SESSION_EXPIRED_MESSAGE = 'La sesión de la consulta expiró. Inicia una nueva consulta con la cédula.';
const GENERIC_ERROR_MESSAGE = 'No fue posible obtener una respuesta del asistente. Inténtalo de nuevo.';
const CLIENT_FOUND_MESSAGE = 'Encontré al cliente. Elige un producto en la tarjeta "Producto" para preparar la venta.';
const PITCH_READY_MESSAGE =
  'Listo. Revisa el resumen del clausulado y el guion sugerido en las tarjetas. Pregúntame lo que necesites o usa las acciones rápidas.';

/** Sales assistant: lead lookup by document, product choice, clausulado-backed pitch, follow-ups and fast actions. */
@Component({
  selector: 'app-agent',
  imports: [ReactiveFormsModule],
  templateUrl: './agent.component.html',
  host: { class: 'block h-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentComponent implements OnInit {
  private readonly agentApi = inject(AgentApiService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly sessionState = inject(SessionStateService);
  private nextMessageId = 1;
  private sessionId: string | null = null;

  @ViewChild('chatBody') private chatBodyRef?: ElementRef<HTMLDivElement>;

  readonly citizenIdForm = this.formBuilder.group({
    citizenId: this.formBuilder.control('', [Validators.required, Validators.pattern(CITIZEN_ID_PATTERN)]),
  });
  readonly messageForm = this.formBuilder.group({
    text: this.formBuilder.control('', [nonBlankValidator, Validators.maxLength(MAX_QUESTION_LENGTH)]),
  });

  readonly brief = signal<AgentBriefDto | null>(null);
  readonly citizenId = signal<string | null>(null);
  readonly client = signal<AgentClientDto | null>(null);
  readonly fastActions = signal<readonly FastActionDto[]>([]);
  readonly isPreparing = signal(false);
  readonly isTyping = signal(false);
  readonly messages = signal<readonly ChatMessage[]>([]);
  readonly mobileTab = signal<MobileTab>('chat');
  readonly products = signal<readonly AgentProductDto[]>([]);
  readonly profile = signal<AgentProfileDto | null>(null);
  readonly showProductPicker = signal(true);
  readonly stage = signal<AgentStage>('intro');

  readonly fastActionGroups = computed(() =>
    FAST_ACTION_GROUP_ORDER.map((group) => ({
      actions: this.fastActions().filter((action) => action.group === group),
      group,
      label: FAST_ACTION_GROUP_LABELS[group],
    })).filter((entry) => entry.actions.length > 0),
  );
  /** Facts grouped by topic in the order a seller reads them: what it covers first, then limits and steps. */
  readonly factGroups = computed<readonly FactGroup[]>(() => {
    const facts = this.brief()?.facts ?? [];
    const topics = [...new Set(facts.map((fact) => fact.topic))].sort(
      (left, right) => this.topicRank(left) - this.topicRank(right),
    );
    return topics.map((topic) => ({
      facts: facts.filter((fact) => fact.topic === topic),
      label: FACT_TOPIC_LABELS[topic] ?? topic,
      topic,
    }));
  });
  readonly aptitudes = computed(() => {
    const profile = this.profile();
    return profile === null
      ? []
      : (Object.keys(APTITUDE_LABELS) as (keyof AgentProfileDto['aptitudes'])[]).map((key) => ({
          apt: profile.aptitudes[key],
          label: APTITUDE_LABELS[key],
        }));
  });
  readonly hasSelectedProduct = computed(() => this.brief() !== null);
  /** Lead name in title case; it lives only in this component and is never stored or sent to the model. */
  readonly clientName = computed(() => toTitleCase(this.client()?.nombreCompleto));
  readonly segmento = computed(() => this.client()?.segmentoBanco ?? null);

  ngOnInit(): void {
    void this.agentApi
      .listFastActions()
      .then((actions) => this.fastActions.set(actions))
      .catch(() => this.fastActions.set([]));
  }

  /** Keep the document field numeric-only. */
  onCitizenIdInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digitsOnly = input.value.replace(/\D/g, '');
    if (digitsOnly !== input.value) {
      this.citizenIdForm.controls.citizenId.setValue(digitsOnly);
    }
  }

  /** Format a citizen id with thousand separators for display only. */
  formatCitizenId(value: string): string {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  ageLabel(segment: AgentProfileDto['ageSegment']): string {
    return AGE_SEGMENT_LABELS[segment];
  }

  /**
   * The model writes [Nombre del Lead] and [Nombre del Asesor]; the names are filled in here, in the browser,
   * so they never travel to the model. A placeholder stays visible when its name is unknown.
   */
  personalize(text: string): string {
    const lead = this.clientName();
    const advisor = toTitleCase(this.sessionState.user()?.displayName);
    return text
      .replace(LEAD_PLACEHOLDER, lead ?? '[Nombre del Lead]')
      .replace(ADVISOR_PLACEHOLDER, advisor ?? '[Nombre del Asesor]');
  }

  titleCase(value: string | null | undefined): string {
    return toTitleCase(value) ?? '—';
  }

  vehicleLabel(vehicle: AgentVehicleDto): string {
    const name = [toTitleCase(vehicle.marca), toTitleCase(vehicle.linea), vehicle.modelo]
      .filter((part) => part !== null && part !== '')
      .join(' ');
    return name === '' ? 'Vehículo sin detalle' : name;
  }

  propertyLabel(property: AgentPropertyDto): string {
    return [toTitleCase(property.tipoInmueble), toTitleCase(property.ciudad), property.estrato === null ? null : `estrato ${property.estrato}`]
      .filter((part) => part !== null && part !== '')
      .join(' · ');
  }

  /** Plans Cliente 360 suggests, e.g. "Autos · Clásico". */
  suggestedPlans(profile: AgentProfileDto): readonly string[] {
    return (Object.keys(APTITUDE_LABELS) as (keyof AgentProfileDto['aptitudes'])[]).flatMap((key) => {
      const plan = profile.planesSugeridos[key];
      return plan === null ? [] : [`${APTITUDE_LABELS[key]} · ${plan}`];
    });
  }

  setMobileTab(tab: MobileTab): void {
    this.mobileTab.set(tab);
    this.scrollToBottomSoon();
  }

  /** Look the lead up in Cliente 360 and show the profile with the products that can be offered. */
  async startConsultation(): Promise<void> {
    if (this.citizenIdForm.invalid) {
      this.citizenIdForm.markAllAsTouched();
      return;
    }

    const citizenId = this.citizenIdForm.controls.citizenId.value;
    this.clearConversation();
    this.citizenId.set(citizenId);
    this.stage.set('chat');
    this.citizenIdForm.reset({ citizenId: '' });

    this.isTyping.set(true);
    try {
      this.applyResponse(await this.agentApi.startSession(citizenId));
    } catch (error: unknown) {
      this.handleFailure(error, START_ERROR_MESSAGE);
    } finally {
      this.isTyping.set(false);
    }
  }

  /** Choose a suggested product and request its verified brief and sales script. */
  async chooseProduct(product: AgentProductDto): Promise<void> {
    const sessionId = this.sessionId;
    if (this.isTyping() || sessionId === null || !product.clausuladoDisponible) {
      return;
    }

    this.appendText('me', product.name);
    this.isPreparing.set(true);
    try {
      await this.runTurn(() => this.agentApi.selectProduct(sessionId, product.id));
    } finally {
      this.isPreparing.set(false);
    }
  }

  /** Trigger a predefined helper for a situation that came up during the call. */
  async runFastAction(action: FastActionDto): Promise<void> {
    const sessionId = this.sessionId;
    if (this.isTyping() || sessionId === null || !this.hasSelectedProduct()) {
      return;
    }

    this.appendText('me', action.label);
    await this.runTurn(() => this.agentApi.runFastAction(sessionId, action.id));
  }

  /** Send a free-text question about the product or about how to handle the lead. */
  async sendMessage(): Promise<void> {
    const text = this.messageForm.controls.text.value.normalize('NFKC').trim();
    const sessionId = this.sessionId;
    if (this.isTyping() || sessionId === null || !this.hasSelectedProduct()) {
      return;
    }

    if (text.length === 0 || this.messageForm.invalid) {
      this.messageForm.markAllAsTouched();
      return;
    }

    this.appendText('me', text);
    this.messageForm.reset({ text: '' });
    await this.runTurn(() => this.agentApi.sendMessage(sessionId, text));
  }

  /** Return to the intro pane and discard the current conversation. */
  resetConsultation(): void {
    if (this.isTyping()) {
      return;
    }

    this.stage.set('intro');
    this.clearConversation();
  }

  private clearConversation(): void {
    this.brief.set(null);
    this.citizenId.set(null);
    this.client.set(null);
    this.isPreparing.set(false);
    this.messages.set([]);
    this.mobileTab.set('chat');
    this.products.set([]);
    this.profile.set(null);
    this.sessionId = null;
    this.showProductPicker.set(true);
  }

  private topicRank(topic: string): number {
    const rank = FACT_TOPIC_ORDER.indexOf(topic);
    return rank === -1 ? FACT_TOPIC_ORDER.length : rank;
  }

  private async runTurn(call: () => Promise<AgentTurnResponse>): Promise<void> {
    this.isTyping.set(true);
    try {
      this.applyResponse(await call());
    } catch (error: unknown) {
      this.handleFailure(error, GENERIC_ERROR_MESSAGE);
    } finally {
      this.isTyping.set(false);
    }
  }

  private handleFailure(error: unknown, fallback: string): void {
    const expired = error instanceof HttpErrorResponse && error.status === 404;
    this.appendText('bot', expired ? SESSION_EXPIRED_MESSAGE : fallback);
  }

  private applyResponse(response: AgentTurnResponse): void {
    if (response.sessionId !== null) {
      this.sessionId = response.sessionId;
    }

    this.appendOutput(response.output);
  }

  private appendOutput(output: AgentOutputDto): void {
    switch (output.kind) {
      case 'not_found':
        this.appendText('bot', NOT_FOUND_MESSAGE);
        return;
      case 'products':
        this.client.set(output.client);
        this.profile.set(output.profile);
        this.products.set(output.products);
        this.mobileTab.set('panel');
        this.appendText('bot', CLIENT_FOUND_MESSAGE);
        return;
      case 'pitch':
        this.brief.set(output.brief);
        this.showProductPicker.set(false);
        this.mobileTab.set('panel');
        this.appendText('bot', PITCH_READY_MESSAGE);
        return;
      case 'answer':
        this.appendText('bot', output.text, output.sources.map((source) => source.title));
        return;
      default:
        this.appendText('bot', output.text);
    }
  }

  private appendText(role: 'bot' | 'me', text: string, sources: readonly string[] = []): void {
    const id = this.nextMessageId++;
    this.messages.update((messages) => [...messages, { id, role, sources, text }]);
    this.scrollToBottomSoon();
  }

  private scrollToBottomSoon(): void {
    setTimeout(() => {
      const element = this.chatBodyRef?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }
}
