import type { Stage } from '../gl/stage';

// Dev-only (?capture): window.__capture(name) renders a frame and saves the canvas to
// review/captures/<name>.png through the dev server. It renders synchronously instead of waiting for
// animation frames, so it also works while the page is hidden.

declare global {
  interface Window {
    __capture?: (name: string) => Promise<boolean>;
  }
}

export function initCapture(stage: Stage, canvas: HTMLCanvasElement, renderFrame: () => void) {
  window.__capture = async (name: string) => {
    await stage.labelReady;
    renderFrame();
    renderFrame();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const response = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    return response.ok;
  };
  document.documentElement.setAttribute('data-capture', 'ready');
}
