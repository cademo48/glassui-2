/** How deep a set (latched) cap sits: below the face, just short of bottoming out. */
export const LATCH_DEPTH = 0.82;

/**
 * The cap's travel: 0 at rest, 1 bottomed out in the glass. Pushing down is quick and firm; settling
 * back into the latch catches with a small bounce; popping back up is softer, with a little overshoot.
 */
export class PressSpring {
  value = 0;
  target = 0;
  private velocity = 0;

  update(dt: number, instant: boolean) {
    if (instant) {
      this.value = this.target;
      this.velocity = 0;
      return;
    }
    const bottoming = this.target > 0.99;
    const catching = !bottoming && this.target > 0.5;
    const k = bottoming ? 1600 : catching ? 1100 : 700;
    const damping = bottoming ? 0.9 : catching ? 0.5 : 0.42;
    const c = 2 * damping * Math.sqrt(k);
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.velocity += (k * (this.target - this.value) - c * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }
}

interface LatchEvents {
  /** The cap was pushed down (it bottoms out). */
  onPress(): void;
  /** A full press toggled the button: true when it is now set into the glass. */
  onToggle(latched: boolean): void;
}

/**
 * A push-on / push-off button. A press is down then up while still over the button; each one toggles
 * whether the cap stays set into the glass. Sliding off before letting go cancels the press.
 */
export class LatchingButton {
  latched = false;
  private held = false;

  constructor(
    private readonly spring: PressSpring,
    private readonly events: LatchEvents,
  ) {}

  private get restDepth() {
    return this.latched ? LATCH_DEPTH : 0;
  }

  get isHeld() {
    return this.held;
  }

  down() {
    if (this.held) return;
    this.held = true;
    this.spring.target = 1;
    this.events.onPress();
  }

  /** The pointer moved on or off the button while held down. */
  hover(over: boolean) {
    if (this.held) this.spring.target = over ? 1 : this.restDepth;
  }

  /** Let go: with commit the press counts and toggles the button, otherwise it is abandoned. */
  up(commit: boolean) {
    if (!this.held) return;
    this.held = false;
    if (commit) {
      this.latched = !this.latched;
      this.events.onToggle(this.latched);
    }
    this.spring.target = this.restDepth;
  }
}

/**
 * The visually hidden <button> that stands in for the cap. It is a toggle button: holding Space or
 * Enter holds the cap down and letting go toggles it, and a click with no key (a screen reader's
 * activation) plays a quick press.
 */
export function bindPressProxy(button: HTMLButtonElement, latch: LatchingButton, onFocus: (visible: boolean) => void) {
  let lastKey = -Infinity;
  const isPressKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';

  button.addEventListener('keydown', (event) => {
    if (!isPressKey(event) || event.repeat) return;
    latch.down();
    lastKey = event.timeStamp;
  });
  button.addEventListener('keyup', (event) => {
    if (!isPressKey(event)) return;
    latch.up(true);
    lastKey = event.timeStamp;
  });
  button.addEventListener('click', (event) => {
    if (event.timeStamp - lastKey < 400 || latch.isHeld) return;
    latch.down();
    window.setTimeout(() => latch.up(true), 120);
  });
  button.addEventListener('focus', () => onFocus(button.matches(':focus-visible')));
  button.addEventListener('blur', () => {
    latch.up(false);
    onFocus(false);
  });
}
