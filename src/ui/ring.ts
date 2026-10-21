const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// The ring is a turntable seen from slightly above: an ellipse in a 132×44 viewBox, with the knob at
// the slab's heading (bottom = facing the viewer). The track stops just past the knob, like the design.
const CX = 66;
const CY = 22;
const RX = 62;
const RY = 19;
const GAP = 24 * DEG;
const SEGMENTS = 72;
const KEY_STEP = 15 * DEG;

export interface RingHandlers {
  /** The knob was dragged to this angle (0 = front, increasing to the right). */
  scrub(angle: number): void;
  /** Arrow keys: turn by this many radians. */
  nudge(delta: number): void;
  /** Page keys and chevrons: one 45° step. */
  step(direction: 1 | -1): void;
  home(): void;
}

export class Ring {
  private shown = Number.NaN;
  private degrees = -1;

  constructor(
    private readonly el: HTMLElement,
    private readonly path: SVGPathElement,
    private readonly knob: SVGCircleElement,
    handlers: RingHandlers,
  ) {
    let pointer: number | null = null;
    const angleAt = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 132 - CX;
      const y = ((event.clientY - rect.top) / rect.height) * 44 - CY;
      return Math.atan2(x / RX, y / RY);
    };
    el.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointer = event.pointerId;
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended; the drag simply won't be captured.
      }
      el.classList.add('is-dragging');
      handlers.scrub(angleAt(event));
    });
    el.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointer) handlers.scrub(angleAt(event));
    });
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('is-dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (event) => {
      const actions: Record<string, () => void> = {
        ArrowRight: () => handlers.nudge(KEY_STEP),
        ArrowUp: () => handlers.nudge(KEY_STEP),
        ArrowLeft: () => handlers.nudge(-KEY_STEP),
        ArrowDown: () => handlers.nudge(-KEY_STEP),
        PageUp: () => handlers.step(1),
        PageDown: () => handlers.step(-1),
        Home: () => handlers.home(),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
  }

  update(yaw: number) {
    if (Math.abs(yaw - this.shown) < 1e-4) return;
    this.shown = yaw;
    const at = (a: number) => [CX + RX * Math.sin(a), CY + RY * Math.cos(a)];
    let d = '';
    for (let i = 0; i <= SEGMENTS; i++) {
      const [x, y] = at(yaw + GAP + ((TAU - GAP) * i) / SEGMENTS);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    this.path.setAttribute('d', d);

    const [kx, ky] = at(yaw);
    const front = (Math.cos(yaw) + 1) / 2; // 1 when the knob is nearest the viewer
    this.knob.setAttribute('cx', kx.toFixed(2));
    this.knob.setAttribute('cy', ky.toFixed(2));
    this.knob.setAttribute('r', (4.2 + 1.2 * front).toFixed(2));
    this.knob.style.opacity = (0.55 + 0.45 * front).toFixed(2);

    const degrees = ((Math.round(yaw / DEG) % 360) + 360) % 360;
    if (degrees !== this.degrees) {
      this.degrees = degrees;
      this.el.setAttribute('aria-valuenow', String(degrees));
      this.el.setAttribute('aria-valuetext', `${degrees} degrees`);
    }
  }
}
