// API 2 figure for 小拉布 / Laboon: a chibi whale with three registered 1024x1024 artworks — the
// front view when idle, the front view with closed eyes (blink / sleep), and the side view while
// walking / running.
//
// Coopanion's body kit does the walking, breathing and particles; this module picks the view with a
// short cross-fade and bobs the side view up and down a little so it reads as swimming.
//
// Frames are made by tools/prepare-art.py: white background -> transparent; the two views are scaled
// so the head (eye->top + eye->jaw) measures the same on both, each lowest point on the bottom edge,
// body centre on x=512.
const NS = 'http://www.w3.org/2000/svg';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// --- the illustration's own pixel space (the two 1024x1024 PNGs) --------------------------------
const ART_W = 1024;
const ART_H = 1024;
const ART_AXIS_X = 512;    // body centre, canvas centre
const ART_GROUND_Y = 1024; // lowest point on the bottom edge

// --- how the artwork is mapped into the kit's logo space (128 x 256 units) ----------------------
const DRAW_H = 279;
const DRAW_W = 279;
const DRAW_X = -11.5;
const DRAW_Y = -23;

// --- view switching ----------------------------------------------------------------------------
const SIDE_LINGER = 0.20;  // keep the side view this long after walking/running stops
const FADE = 0.12;         // cross-fade between the two views (~3-7 frames)
const BOB_PERIOD = 0.60;   // seconds per swim bob
const BOB_PEAK = 6;        // px of downward bob at most (bob runs -6..0, never below the ground)

export async function createLaboonBody(base, { kit, host, loadImage, asset }) {
  const files = ['laboon.png', 'laboon-side.png', 'laboon-closed.png'];
  const images = await Promise.all(files.map((file) => loadImage(String(asset(file)))));
  const doc = host.root.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.width = 635;
  canvas.height = 635;
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  const ctx = canvas.getContext('2d');
  const surface = doc.createElementNS(NS, 'foreignObject');
  surface.setAttribute('x', String(DRAW_X));
  surface.setAttribute('y', String(DRAW_Y));
  surface.setAttribute('width', String(DRAW_W));
  surface.setAttribute('height', String(DRAW_H));
  // Both drawings face right / toward the viewer, like the kit's unmirrored body: no mirror.
  surface.appendChild(canvas);
  let mounted = false;
  // view transition state: 0 = front (idle), 1 = side (moving)
  let sideAt = -1e9;
  let current = 0;
  let previous = 0;
  let fadeAt = -1e9;
  const figure = {
    colors: { z: '#2f6ea8' },
    get extent() { return [-5.8, 96.1, 262.1, 255.7]; },
    hits: [[128.0, 180.9, 70.8], [128.1, 176.7, 67.2], [38.4, 176.7, 39.8]],
    get anchors() {
      return {
        gaze: [128.0, 184.3], tear: [182.4, 198.2], tears: [[73.7, 200.4], [182.4, 198.2]],
        z: [127.9, 94.2], hearts: [127.9, 222.2, 30.0], bubble: [127.9, 90.1],
      };
    },
    setScheme() {},
    draw(group, face, f) {
      if (!mounted) { group.appendChild(surface); mounted = true; }
      const t = f.t;
      const moving = f.mode === 'walk' || f.mode === 'run';
      if (moving) sideAt = t;
      const wantSide = moving || (t - sideAt) < SIDE_LINGER;
      const target = wantSide ? 1 : 0;
      if (target !== current) { previous = current; current = target; fadeAt = t; }
      const fade = clamp((t - fadeAt) / FADE, 0, 1);
      // Closed eyes: only in the front view (blink, sleep, and the drowsy face).
      const sleepy =
        ['sleep', 'sleepy', 'bowing'].includes(f.face) ||
        (f.face === 'content' && f.drowse > 0.7);
      const blink = Math.max(f.blink || 0, f.eyeClose || 0) > 0.45;
      const closed = !moving && (sleepy || blink);

      const sit = clamp(f.sit || 0, 0, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 635, 635);
      ctx.scale(635 / ART_W, 635 / ART_H);
      ctx.save();
      // Sitting: the body sinks and squashes a little.
      ctx.translate(ART_AXIS_X, ART_GROUND_Y);
      ctx.scale(1, 1 - 0.1 * sit);
      ctx.translate(-ART_AXIS_X, -ART_GROUND_Y);

      const drawView = (view, alpha) => {
        if (alpha <= 0.001) return;
        // Closed eyes only exist for the front view: while moving, the eyes stay open (no jump).
        const image = view === 0 && closed ? images[2] : images[view];
        // Swim bob on the side view only: 0 .. -BOB_PEAK px, so the belly never sinks below the ground.
        const bob = view === 1 ? -BOB_PEAK / 2 + (BOB_PEAK / 2) * Math.sin((2 * Math.PI * t) / BOB_PERIOD) : 0;
        ctx.globalAlpha = alpha;
        ctx.drawImage(image, 0, bob);
        ctx.globalAlpha = 1;
      };
      if (fade < 1) drawView(previous, 1 - fade);
      drawView(current, fade);
      ctx.restore();
    },
  };
  const body = kit.createBody(host, { figure });
  return body;
}
