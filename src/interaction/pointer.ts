import type { Stage } from '../gl/stage';
import type { LatchingButton } from './press';
import type { Turntable } from './turntable';

interface PointerDeps {
  canvas: HTMLCanvasElement;
  stage: Stage;
  turntable: Turntable;
  button: LatchingButton;
  dragGain: () => number;
  reduceMotion: MediaQueryList;
}

/**
 * Pointer input on the canvas. A press that starts on the button pushes the cap; letting go over it
 * toggles the button, and sliding off first cancels. Anywhere else, dragging turns the slab:
 * sideways spins, up/down tilts.
 */
export function bindPointer({ canvas, stage, turntable, button, dragGain, reduceMotion }: PointerDeps) {
  let drag: { id: number; x: number; y: number; t: number } | null = null;
  let pressId: number | null = null;
  const overButton = (event: PointerEvent) => stage.buttonAt(event.clientX, event.clientY, canvas);

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer already ended; the gesture simply won't be captured.
    }
    if (overButton(event)) {
      pressId = event.pointerId;
      button.down();
      return;
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
    turntable.beginDrag();
    canvas.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === pressId) {
      button.hover(overButton(event));
      return;
    }
    if (drag && event.pointerId === drag.id) {
      const gain = dragGain();
      const seconds = (event.timeStamp - drag.t) / 1000;
      turntable.dragBy((event.clientX - drag.x) * gain, (event.clientY - drag.y) * gain, seconds);
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.t = event.timeStamp;
      return;
    }
    if (event.pointerType === 'mouse') canvas.classList.toggle('is-over-button', overButton(event));
  });

  const release = (event: PointerEvent) => {
    if (event.pointerId === pressId) {
      pressId = null;
      button.up(event.type === 'pointerup' && overButton(event));
    }
    if (drag && event.pointerId === drag.id) {
      // A flick keeps turning; a drag that paused before letting go stops where it is.
      const flick = event.type === 'pointerup' && event.timeStamp - drag.t < 80 && !reduceMotion.matches;
      turntable.endDrag(flick);
      drag = null;
      canvas.classList.remove('is-dragging');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('is-over-button'));
}
