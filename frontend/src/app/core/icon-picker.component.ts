import { ChangeDetectionStrategy, Component, HostListener, computed, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

import { BOOTSTRAP_ICON_NAMES, POPULAR_BOOTSTRAP_ICON_NAMES } from './bootstrap-icons';

const MAX_RESULTS_SHOWN = 240;
const ICON_CLASS_PREFIX = 'bi bi-';

/** A clickable Bootstrap Icons picker usable as a reactive form control (formControlName). */
@Component({
  selector: 'app-icon-picker',
  imports: [FormsModule],
  templateUrl: './icon-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IconPickerComponent),
      multi: true,
    },
  ],
})
export class IconPickerComponent implements ControlValueAccessor {
  readonly disabled = signal(false);
  readonly isOpen = signal(false);
  readonly searchTerm = signal('');
  readonly value = signal('');

  readonly iconName = computed(() => this.value().replace(ICON_CLASS_PREFIX, ''));
  readonly isTruncated = computed(() => this.searchResults().length > MAX_RESULTS_SHOWN);

  readonly visibleResults = computed(() => this.searchResults().slice(0, MAX_RESULTS_SHOWN));

  private readonly searchResults = computed(() => {
    const term = this.searchTerm().normalize('NFKC').trim().toLowerCase();
    return term.length === 0
      ? POPULAR_BOOTSTRAP_ICON_NAMES
      : BOOTSTRAP_ICON_NAMES.filter((name) => name.includes(term));
  });

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  /** Close the picker when it is open and the user presses Escape anywhere on the page. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.close();
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  /** Open the picker and clear the previous search. */
  open(): void {
    if (this.disabled()) {
      return;
    }

    this.searchTerm.set('');
    this.isOpen.set(true);
  }

  /** Close the picker without changing the current selection. */
  close(): void {
    this.isOpen.set(false);
    this.onTouched();
  }

  /** Select an icon by its bare Bootstrap Icons name and close the picker. */
  select(name: string): void {
    const iconClass = `${ICON_CLASS_PREFIX}${name}`;
    this.value.set(iconClass);
    this.onChange(iconClass);
    this.close();
  }
}
