/**
 * Library thumbnails of Motion clips. Each one runs the clip in its own sandbox and renders one
 * frame, a few at a time; the most recently requested (what is on screen now) go first, and
 * requests for tiles that scrolled away are dropped. Results are kept as small canvases.
 */

import { testMotion } from '@/engine/media/motion';
import type { MotionMeta, MotionValue } from '@shared/motion';

export interface PosterRequest {
  code: string;
  meta: MotionMeta;
  time: number;
  values?: Record<string, MotionValue>;
}

type Poster = HTMLCanvasElement | null;
type Waiter = (p: Poster) => void;

interface Job {
  key: string;
  req: PosterRequest;
  waiters: Set<Waiter>;
}

const CONCURRENCY = 3;
const MAX_CACHED = 240;

const cache = new Map<string, Poster>();
const queued = new Map<string, Job>();
const order: Job[] = [];
let running = 0;

function remember(key: string, p: Poster): void {
  cache.delete(key);
  cache.set(key, p);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

function toCanvas(b: ImageBitmap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  c.getContext('2d')!.drawImage(b, 0, 0);
  b.close();
  return c;
}

function pump(): void {
  while (running < CONCURRENCY && order.length) {
    // Newest first: the tiles the user is looking at right now.
    const job = order.pop()!;
    if (!job.waiters.size) {
      queued.delete(job.key);
      continue;
    }
    running++;
    void testMotion(job.req.code, job.req.meta, [job.req.time], job.req.values)
      .then((r) => (r.ok && r.frames[0] ? toCanvas(r.frames[0]) : null))
      .catch(() => null)
      .then((p) => {
        running--;
        queued.delete(job.key);
        remember(job.key, p);
        for (const w of job.waiters) w(p);
        pump();
      });
  }
}

/** A cached poster (undefined when it has not been rendered yet). */
export function cachedPoster(key: string): Poster | undefined {
  const p = cache.get(key);
  if (p !== undefined) remember(key, p);
  return p;
}

/** Ask for a poster; `done` gets it (null when the clip failed). Returns a function that withdraws the request. */
export function requestPoster(key: string, make: () => PosterRequest, done: Waiter): () => void {
  const hit = cachedPoster(key);
  if (hit !== undefined) {
    done(hit);
    return () => undefined;
  }
  let job = queued.get(key);
  if (!job) {
    job = { key, req: make(), waiters: new Set() };
    queued.set(key, job);
    order.push(job);
  } else {
    // Asked again: move it to the front.
    const i = order.indexOf(job);
    if (i >= 0) {
      order.splice(i, 1);
      order.push(job);
    }
  }
  job.waiters.add(done);
  pump();
  const j = job;
  return () => void j.waiters.delete(done);
}
