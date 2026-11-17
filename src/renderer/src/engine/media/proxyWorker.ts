/**
 * Proxy worker: runs one proxy transcode off the UI thread. Bytes are posted back to the page,
 * which writes them through the main process (the bridge is not available in workers); each
 * write waits for an acknowledgement so the encoder respects disk back-pressure.
 */

import { ProxyCanceled, runProxyConversion, type ProxyRun, type ProxySpec } from './proxyConvert';

type InMsg = { type: 'start'; spec: ProxySpec } | { type: 'cancel' } | { type: 'ack'; id: number; error?: string };

// Typed structurally: the renderer project compiles against the DOM lib, not the WebWorker one.
const scope = self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void; onmessage: ((e: MessageEvent<InMsg>) => void) | null };
const pending = new Map<number, { ok: () => void; ko: (e: Error) => void }>();
let nextId = 1;
let run: ProxyRun | null = null;
let lastProgress = 0;

scope.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'ack') {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.ko(new Error(msg.error));
    else p?.ok();
  } else if (msg.type === 'cancel') {
    run?.cancel();
  } else if (msg.type === 'start') {
    run = runProxyConversion(msg.spec, {
      write: (position, data) =>
        new Promise<void>((ok, ko) => {
          const id = nextId++;
          pending.set(id, { ok, ko });
          // Copy: Mediabunny may reuse the chunk buffer after the promise resolves.
          const copy = data.slice();
          scope.postMessage({ type: 'write', id, position, data: copy }, [copy.buffer]);
        }),
      progress: (ratio) => {
        const now = performance.now();
        if (now - lastProgress < 120 && ratio < 1) return;
        lastProgress = now;
        scope.postMessage({ type: 'progress', ratio });
      },
    });
    run.promise.then(
      () => scope.postMessage({ type: 'done' }),
      (err: unknown) => scope.postMessage(err instanceof ProxyCanceled ? { type: 'canceled' } : { type: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  }
};

scope.postMessage({ type: 'ready' });
