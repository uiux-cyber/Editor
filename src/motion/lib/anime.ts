// anime.js for Motion clips. Its engine runs on the clip clock (no free-running loop); for exact
// frames create animations with autoplay: false and call .seek(t * 1000) in render.
import { engine } from 'animejs';

const host = (globalThis as unknown as { __kinoraMotion?: { onTime(fn: (t: number) => void): void } }).__kinoraMotion;
if (host) {
  engine.useDefaultMainLoop = false;
  host.onTime(() => engine.update());
}

export * from 'animejs';
