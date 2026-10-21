// Shared 3D mount helper for minigames (contracts section 10, "3D MINIGAMES").
//
// RULE: three.js is NEVER imported statically. Not here, not in any src/minigames/<id>/*.js that `index.js` reaches at load time: the registry
// (`import.meta.glob('./*/index.js', { eager: true })`) pulls every minigame's index.js into the MAIN bundle. three comes in through
// `t3.THREE` (this helper does `await import('three')`, so Vite emits it as its own lazy chunk) or, inside a 3D game's own client file, through a
// dynamic `import('three')` that only runs from clientMount. `npm run build` must keep showing three in a separate chunk.
//
//   const t3 = await mount3D(ctx);
//   t3.THREE      the three.js namespace (all of it)
//   t3.renderer   THREE.WebGLRenderer (antialias, DPR capped at 2), already sized
//   t3.scene      THREE.Scene (yours; the canvas is opaque: set opts.background or scene.background, else it clears to black)
//   t3.camera     THREE.PerspectiveCamera (opts.fov / near / far; aspect is kept in sync on resize)
//   t3.canvas     the WebGL <canvas>: position:fixed over this lane's rect of the Kaplay canvas, pointer-events:none
//   t3.overlay    <div> exactly over the canvas, above it, pointer-events:none, CSS var --u = screen px per logical unit (HUD text, see below)
//   t3.size       { w, h } CSS px of the canvas now
//   t3.onFrame(fn(dtSec))   per-frame hook, called BEFORE the render (returns an unsubscribe fn). Frames come from ctx.root.onUpdate, so a destroyed lane stops.
//   t3.onResize(fn(w, h))   called after the canvas was re-fitted (camera aspect is already updated)
//   t3.label(text, { x, y, size, color, align }) -> HTMLElement   HUD text at LOGICAL lane coords (see "HUD text")
//   t3.render()             render once now (only needed with opts.autoRender === false)
//   t3.destroyed            true after destroy()
//   t3.destroy()            idempotent; disposes geometries, materials, textures, the renderer (context released) and removes canvas + overlay
//
// LIFECYCLE
//   * clientMount(ctx) must return its MinigameInstance SYNCHRONOUSLY. Kick off `mount3D(ctx).then(...)` inside and keep going in the .then. Until the promise
//     resolves, draw nothing or a Kaplay "lädt…" label. The three chunk is preloaded for you if the module has `preload: () => preload3D()` (the runner calls it
//     while the instructions are on screen), so the usual wait is zero.
//   * mount3D registers t3.destroy with the runner (ctx.onEnd): the runner tears the canvas down when the minigame ends, on its results screen, when the
//     player leaves, and on a remount. You may also call t3.destroy() from instance.destroy(); that is harmless (idempotent). NEVER leave the canvas to the GC.
//   * If the lane ended while three was still loading, the promise simply never resolves (nothing is created, nothing to clean up).
//   * It rejects if WebGL is unavailable or the chunk fails to load: `.catch` it, draw a Kaplay fallback (ctx.k + ctx.root) and still call ctx.finish(...).
//
// VIEWS
//   * Only view 'main' gets a WebGL canvas. Browsers cap WebGL contexts (~8-16) and thumbnails would be up to 5 per player: mount3D(ctx) THROWS for
//     view 'thumb'. In thumb view draw a cheap 2D progress picture with Kaplay (a track + a coloured dot per progress `p`, a bar, the score...), driven
//     by instance.update(p). The main instance sends that `p` with ctx.sendProgress(p).
//   * Solo: the canvas covers the big own lane (ctx.rect, 960x720 logical, x0.8 with >3 opponents). Arena/team: the whole screen (1280x720).
//
// HUD TEXT: the Kaplay canvas sits BELOW the WebGL canvas, so Kaplay text drawn in the lane would be hidden. Pick one:
//   (a) (default, simplest) text on the DOM overlay: `t3.label('Score 12', { x: 20, y: 20, size: 36 })`; update with `el.textContent = ...`. Coordinates and size are
//       LOGICAL lane px (ctx.logical), the overlay scales them. Plain system-ui text; use it for scores / hints only.
//   (b) opts.alpha:true gives a transparent canvas (Kaplay shows through where nothing is drawn); then Kaplay text in the lane is visible there. Rarely needed.
//   The runner's countdown (3-2-1-LOS!) and the "Fertig…" caption are mirrored onto the overlay automatically (opts.hud !== false).
//
// Letterbox: main.js makes ONE Kaplay canvas (100vw x 100vh in #app) and Kaplay letterboxes the 1280x720 view inside it. This helper maps the lane rect to the
// letterboxed view, so the WebGL canvas tracks window resizes and fullscreen. Z-order: inserted right after the Kaplay canvas, positioned without z-index,
// so it paints above the Kaplay canvas and below #ui (the DOM HUD/menus, which come later in the DOM).

import { SCREEN } from '../contracts.js';

let threePromise = null;
/** Starts fetching the three.js chunk (idempotent). Use as `preload: () => preload3D()` on the module object; the runner calls it during the intro. */
export function preload3D() {
  threePromise ??= import('three').catch((e) => { threePromise = null; throw e; });
  return threePromise;
}

/** Lane rect (SCREEN px, x/y/w/h) -> CSS px on the page, given the Kaplay canvas element. Pure apart from reading the canvas' bounding box. */
export function laneToDom(kCanvas, rect, screen = SCREEN) {
  const cr = kCanvas.getBoundingClientRect();
  const aspect = screen.w / screen.h;
  let vw = cr.width, vh = cr.height, ox = 0, oy = 0;
  if (cr.width / cr.height > aspect) { vw = cr.height * aspect; ox = (cr.width - vw) / 2; } else { vh = cr.width / aspect; oy = (cr.height - vh) / 2; }
  const s = vw / screen.w;
  const left = Math.round(cr.left + ox + rect.x * s), top = Math.round(cr.top + oy + rect.y * s);
  return { left, top, width: Math.max(1, Math.round(cr.left + ox + (rect.x + rect.w) * s) - left), height: Math.max(1, Math.round(cr.top + oy + (rect.y + rect.h) * s) - top), s };
}

const HUD_FONT = 'system-ui, "Segoe UI", sans-serif';
const STROKE = '0 0 0.12em #14182a, 0 0 0.12em #14182a, 0 0 0.12em #14182a, 0 0 0.12em #14182a';

/**
 * @param {any} ctx MinigameCtx of a MAIN view instance (needs ctx.k, ctx.rect, ctx.onEnd, ctx.alive, ctx.mirrorHud, ctx.root, ctx.logical)
 * @param {{ fov?:number, near?:number, far?:number, alpha?:boolean, background?:(number|string), antialias?:boolean, autoRender?:boolean, hud?:boolean, maxDpr?:number }} [opts]
 *   background: scene.background colour (hex number or css string). alpha:true = transparent canvas. autoRender:false = you call t3.render() yourself.
 * @returns {Promise<T3>}
 */
export async function mount3D(ctx, opts = {}) {
  if (ctx.view !== 'main') throw new Error("mount3D: thumbnails must not create WebGL contexts, draw a 2D progress picture with Kaplay instead");
  if (!ctx.rect || !ctx.onEnd || !ctx.alive) throw new Error('mount3D: ctx comes from an old runner (no ctx.rect / onEnd / alive)');
  const THREE = await preload3D();
  if (!ctx.alive()) return new Promise(() => {});   // the lane ended while the chunk loaded: build nothing, never resolve (see LIFECYCLE)

  const kCanvas = ctx.k.canvas;
  const maxDpr = opts.maxDpr ?? 2;
  const canvas = document.createElement('canvas');
  canvas.dataset.testid = 'mg-canvas-3d';
  canvas.style.cssText = 'position:fixed;pointer-events:none;display:block;outline:none';
  const overlay = document.createElement('div');
  overlay.dataset.testid = 'mg-overlay-3d';
  overlay.style.cssText = `position:fixed;pointer-events:none;overflow:hidden;font-family:${HUD_FONT};user-select:none`;
  kCanvas.after(canvas, overlay);   // DOM order: Kaplay canvas, our canvas, our overlay ... #ui (later in body) => #ui stays on top

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias ?? true, alpha: !!opts.alpha, powerPreference: 'high-performance' });
  } catch (e) { canvas.remove(); overlay.remove(); throw e; }
  if (!renderer.getContext()) { canvas.remove(); overlay.remove(); throw new Error('mount3D: no WebGL'); }

  const scene = new THREE.Scene();
  if (opts.background !== undefined) scene.background = new THREE.Color(opts.background);
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 60, 16 / 9, opts.near ?? 0.1, opts.far ?? 300);
  const frameHooks = new Set(), resizeHooks = new Set();
  let destroyed = false;

  const t3 = {
    THREE, renderer, scene, camera, canvas, overlay, size: { w: 1, h: 1 },
    get destroyed() { return destroyed; },
    onFrame(fn) { frameHooks.add(fn); return () => frameHooks.delete(fn); },
    onResize(fn) { resizeHooks.add(fn); return () => resizeHooks.delete(fn); },
    render() { if (!destroyed) renderer.render(scene, camera); },
    label(text, { x = 0, y = 0, size = 32, color = '#ffffff', align = 'left' } = {}) {
      const el = document.createElement('div');
      el.textContent = text;
      const tx = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0';
      el.style.cssText = `position:absolute;left:calc(${x} * var(--u));top:calc(${y} * var(--u));transform:translateX(${tx});font-size:calc(${size} * var(--u));`
        + `font-weight:800;line-height:1.1;white-space:pre;color:${color};text-shadow:${STROKE}`;
      overlay.append(el);
      return el;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      frameHooks.clear(); resizeHooks.clear();
      window.removeEventListener('resize', fit);
      ro?.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material ?? [])) {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose?.();
        }
      });
      scene.background?.dispose?.();
      scene.clear();
      try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* already gone */ }
      canvas.remove(); overlay.remove();
    },
  };

  // ---- fit to the lane, letterbox-aware
  function fit() {
    if (destroyed) return;
    const r = laneToDom(kCanvas, ctx.rect);
    for (const el of [canvas, overlay]) Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    overlay.style.setProperty('--u', `${r.width / ctx.logical.w}px`);
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(r.width, r.height, false);   // false: leave the CSS size to us
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    t3.size.w = r.width; t3.size.h = r.height;
    for (const fn of resizeHooks) fn(r.width, r.height);
    if (opts.autoRender === false) return;
    renderer.render(scene, camera);   // no flash of an empty canvas while resizing
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(kCanvas);
  window.addEventListener('resize', fit);
  fit();

  // ---- runner HUD mirror: countdown digits + caption (the Kaplay ones are hidden below our canvas)
  if (opts.hud !== false) {
    const cd = document.createElement('div');
    cd.style.cssText = `position:absolute;left:50%;top:50%;font-size:calc(220 * var(--u));font-weight:900;line-height:1;white-space:nowrap;text-shadow:${STROKE};opacity:0`;
    const cap = t3.label('', { x: ctx.logical.w / 2, y: ctx.logical.h - 48, size: 22, align: 'center' });
    ctx.mirrorHud((h) => {
      if (destroyed) return;
      cap.textContent = h.caption;
      if (h.countdown) {
        cd.textContent = h.countdown.text;
        cd.style.color = h.countdown.color;
        cd.style.opacity = String(h.countdown.opacity);
        cd.style.transform = `translate(-50%,-50%) scale(${h.countdown.scale})`;
      } else cd.style.opacity = '0';
    });
    overlay.append(cd);
  }

  // ---- frames: driven by the lane's own update (dies with ctx.root), hooks first, then the render
  ctx.root.onUpdate(() => {
    if (destroyed) return;
    const dt = Math.min(0.1, ctx.k.dt());
    for (const fn of frameHooks) fn(dt);
    if (opts.autoRender !== false && !destroyed) renderer.render(scene, camera);
  });

  ctx.onEnd(() => t3.destroy());
  if (!ctx.alive()) t3.destroy();
  return t3;
}
