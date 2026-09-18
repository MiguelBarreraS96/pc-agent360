import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { GeminiPreviewApiService } from '../../core/gemini-preview-api.service';
import { nonBlankValidator } from '../../core/input-normalization';

type AgentStage = 'intro' | 'chat';
type MessageRole = 'bot' | 'me';

interface ChatMessage {
  readonly id: number;
  readonly role: MessageRole;
  readonly text: string;
}

const CITIZEN_ID_PATTERN = /^\d{6,15}$/;
const MAX_QUESTION_LENGTH = 1_000;
const SUGGESTED_PROMPTS: readonly string[] = [
  'Hola, ¿cómo estás?',
  'Explícame qué es una póliza de seguros.',
  '¿Qué puedes hacer en esta prueba?',
  'Resume en una frase por qué es importante asegurar un vehículo.',
];
const LOCAL_GEMINI_NOTICE =
  'Estás probando la conexión local con Gemini. No envíes cédulas, nombres, correos ni otros datos personales.';
const GEMINI_CONNECTION_ERROR =
  'No fue posible obtener una respuesta de Gemini. Verifica que el backend local y tus credenciales de Vertex AI estén disponibles.';

/** Local Gemini connectivity experience that keeps the citizen identifier outside the model request. */
@Component({
  selector: 'app-agent',
  imports: [ReactiveFormsModule],
  templateUrl: './agent.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentComponent {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly geminiPreviewApi = inject(GeminiPreviewApiService);
  private nextMessageId = 1;

  @ViewChild('chatBody') private chatBodyRef?: ElementRef<HTMLDivElement>;

  readonly citizenIdForm = this.formBuilder.group({
    citizenId: this.formBuilder.control('', [Validators.required, Validators.pattern(CITIZEN_ID_PATTERN)]),
  });
  readonly messageForm = this.formBuilder.group({
    text: this.formBuilder.control('', [nonBlankValidator, Validators.maxLength(MAX_QUESTION_LENGTH)]),
  });

  readonly citizenId = signal<string | null>(null);
  readonly isTyping = signal(false);
  readonly messages = signal<readonly ChatMessage[]>([]);
  readonly stage = signal<AgentStage>('intro');
  readonly suggestedPrompts = SUGGESTED_PROMPTS;

  /** Keep the citizen id field numeric-only as the local test interface does not send it to Gemini. */
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

  /** Validate the local reference identifier and transition into the Gemini chat. */
  startConsultation(): void {
    if (this.citizenIdForm.invalid) {
      this.citizenIdForm.markAllAsTouched();
      return;
    }

    const citizenId = this.citizenIdForm.controls.citizenId.value;
    this.citizenId.set(citizenId);
    this.messages.set([]);
    this.stage.set('chat');
    this.citizenIdForm.reset({ citizenId: '' });
    this.showTypingThen(LOCAL_GEMINI_NOTICE);
  }

  /** Send one suggested question through the same direct Gemini connectivity flow. */
  sendPrompt(prompt: string): void {
    if (this.isTyping()) {
      return;
    }

    this.messageForm.controls.text.setValue(prompt);
    void this.sendMessage();
  }

  /** Send one user question to the authenticated local Gemini route and render its safe response. */
  async sendMessage(): Promise<void> {
    const text = this.messageForm.controls.text.value.normalize('NFKC').trim();
    if (this.isTyping()) {
      return;
    }

    if (text.length === 0 || this.messageForm.invalid) {
      this.messageForm.markAllAsTouched();
      return;
    }

    this.appendMessage('me', text);
    this.messageForm.reset({ text: '' });
    this.isTyping.set(true);
    this.scrollToBottomSoon();

    try {
      const response = await this.geminiPreviewApi.askQuestion({ question: text });
      this.appendMessage('bot', response.answer);
    } catch {
      this.appendMessage('bot', GEMINI_CONNECTION_ERROR);
    } finally {
      this.isTyping.set(false);
    }
  }

  /** Return to the intro pane and discard the current local connectivity conversation. */
  resetConsultation(): void {
    if (this.isTyping()) {
      return;
    }

    this.stage.set('intro');
    this.citizenId.set(null);
    this.messages.set([]);
  }

  /** Show the local test notice with the existing typing affordance. */
  private showTypingThen(text: string): void {
    this.isTyping.set(true);
    this.scrollToBottomSoon();

    const delayMilliseconds = 700 + Math.random() * 500;
    setTimeout(() => {
      this.isTyping.set(false);
      this.appendMessage('bot', text);
    }, delayMilliseconds);
  }

  /** Append a message and retain a stable template identifier. */
  private appendMessage(role: MessageRole, text: string): void {
    const id = this.nextMessageId++;
    this.messages.update((messages) => [...messages, { id, role, text }]);
    this.scrollToBottomSoon();
  }

  /** Scroll the message viewport after Angular renders the new item. */
  private scrollToBottomSoon(): void {
    setTimeout(() => {
      const element = this.chatBodyRef?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }
}
