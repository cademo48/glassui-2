import { QUALITY_TIERS, type QualityTier } from '../gl/quality';

// The quality picker, bottom left: a pill button that opens a frosted list upward. "Auto" leaves the
// governor in charge; any tier locks it. The choice is remembered per browser, like the sound toggle.
// Keyboard: Enter, Space or the arrows open it; the arrows, Home and End move; Enter or Space picks;
// Esc or Tab closes.

const PREF_KEY = 'press-quality';

/** null = Auto. */
export type QualityChoice = number | null;

export interface QualityMenuHandlers {
  choose(choice: QualityChoice): void;
  /** The tier actually in use, shown next to "Auto". */
  current(): number;
}

export function readQualityPref(): QualityChoice {
  try {
    const value = localStorage.getItem(PREF_KEY);
    const tier = value === null ? Number.NaN : Number(value);
    return Number.isInteger(tier) && tier >= 0 && tier < QUALITY_TIERS.length ? tier : null;
  } catch {
    return null;
  }
}

function writeQualityPref(choice: QualityChoice) {
  try {
    if (choice === null) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, String(choice));
  } catch {
    // Storage unavailable (private mode); the choice just isn't remembered.
  }
}

const detail = (tier: QualityTier) =>
  `${tier.dpr}× resolution · ${tier.bounces} bounces${tier.rimSamples > 1 ? ' · smooth rims' : ''}`;

export class QualityMenu {
  private choice: QualityChoice;
  private active = 0;
  private readonly options: HTMLLIElement[];

  constructor(
    root: HTMLElement,
    private readonly button: HTMLButtonElement,
    private readonly value: HTMLElement,
    private readonly list: HTMLUListElement,
    private readonly handlers: QualityMenuHandlers,
    initial: QualityChoice,
  ) {
    this.choice = initial;
    const entries: { choice: QualityChoice; name: string; note: string }[] = [
      { choice: null, name: 'Auto', note: 'Stays sharp; adjusts to this device' },
      ...QUALITY_TIERS.map((tier, i) => ({ choice: i, name: tier.name, note: detail(tier) })),
    ];
    this.options = entries.map((entry, i) => {
      const option = document.createElement('li');
      option.id = `quality-option-${i}`;
      option.className = 'quality-option';
      option.setAttribute('role', 'option');
      option.dataset.index = String(i);
      const name = document.createElement('span');
      name.className = 'quality-option-name';
      name.textContent = entry.name;
      const note = document.createElement('span');
      note.className = 'quality-option-note';
      note.textContent = entry.note;
      option.append(name, note);
      option.addEventListener('click', () => this.pick(i));
      option.addEventListener('pointermove', () => this.highlight(i));
      return option;
    });
    list.append(...this.options);

    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.open();
      }
    });
    list.addEventListener('keydown', (event) => this.onKey(event));
    list.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget as Node | null)) this.close(false);
    });
    document.addEventListener('pointerdown', (event) => {
      if (this.isOpen && !root.contains(event.target as Node)) this.close(false);
    });
    this.render();
  }

  private get isOpen() {
    return !this.list.hidden;
  }

  private indexOf(choice: QualityChoice) {
    return choice === null ? 0 : choice + 1;
  }

  /** Refreshes the button: "Auto · Balanced" follows the governor as it steps. */
  update() {
    const name = this.choice === null ? 'Auto' : QUALITY_TIERS[this.choice].name;
    const text = this.choice === null ? `Auto · ${QUALITY_TIERS[this.handlers.current()].name}` : name;
    if (this.value.textContent !== text) this.value.textContent = text;
  }

  private render() {
    const selected = this.indexOf(this.choice);
    this.options.forEach((option, i) => option.setAttribute('aria-selected', String(i === selected)));
    this.update();
  }

  private highlight(i: number) {
    this.active = i;
    this.options.forEach((option, j) => option.classList.toggle('is-active', j === i));
    this.list.setAttribute('aria-activedescendant', this.options[i].id);
  }

  private open() {
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.highlight(this.indexOf(this.choice));
    this.list.focus();
  }

  private close(refocus = true) {
    if (!this.isOpen) return;
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (refocus) this.button.focus();
  }

  private pick(i: number) {
    const choice = i === 0 ? null : i - 1;
    this.close();
    if (choice === this.choice) return;
    this.choice = choice;
    writeQualityPref(choice);
    this.handlers.choose(choice);
    this.render();
  }

  private onKey(event: KeyboardEvent) {
    const last = this.options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(this.active + 1, last),
      ArrowUp: Math.max(this.active - 1, 0),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      this.highlight(moves[event.key]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.pick(this.active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Tab') {
      this.close(false);
    }
  }
}
