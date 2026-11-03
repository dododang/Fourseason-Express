// FPS / frame-time / draw-call overlay, only when the URL has ?debug.
// stats.js is loaded lazily so it never ships in the normal bundle path.
import type * as THREE from 'three';

export interface FrameHooks {
  begin: () => void;
  end: () => void;
}

const noop: FrameHooks = { begin: () => {}, end: () => {} };

export async function setupDebugStats(renderer: THREE.WebGLRenderer): Promise<FrameHooks> {
  if (!new URLSearchParams(location.search).has('debug')) return noop;

  let Stats: typeof import('stats.js');
  try {
    Stats = (await import('stats.js')).default;
  } catch (err) {
    console.warn('stats.js failed to load', err);
    return noop;
  }
  const stats = new Stats();
  stats.showPanel(0); // tap the panel to cycle FPS / ms / MB
  const el = stats.dom;
  el.style.top = 'calc(env(safe-area-inset-top) + 8px)';
  el.style.left = 'calc(env(safe-area-inset-left) + 8px)';
  el.style.zIndex = '50';
  document.body.appendChild(el);

  // Draw calls and triangles, refreshed twice a second.
  const info = document.createElement('div');
  info.style.cssText =
    'position:fixed;z-index:50;left:calc(env(safe-area-inset-left) + 8px);' +
    'top:calc(env(safe-area-inset-top) + 60px);padding:2px 6px;border-radius:4px;' +
    'background:rgba(0,0,0,0.55);color:#fff;font:11px/1.4 monospace;pointer-events:none;';
  document.body.appendChild(info);
  let lastInfo = 0;

  return {
    begin: () => stats.begin(),
    end: () => {
      stats.end();
      const now = performance.now();
      if (now - lastInfo > 500) {
        lastInfo = now;
        const r = renderer.info.render;
        const pr = renderer.getPixelRatio().toFixed(2);
        info.textContent = `draw ${r.calls} · tri ${r.triangles} · dpr ${pr}`;
      }
    },
  };
}
