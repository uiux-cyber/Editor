import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOTION_EXAMPLES, MOTION_FONTS, MOTION_LIBRARIES, motionGuide, normalizeMotionMeta, parseMotionFile, serializeMotionFile, type MotionMeta } from '@shared/motion';

const meta: MotionMeta = { name: 'Intro', width: 1920, height: 1080, duration: 4, fps: 30, seed: 1, images: { logo: 'as_1' } };
const code = 'export default function setup(k) {\n  return (t) => {};\n}\n';

describe('.kmotion files', () => {
  it('round-trips the header and the code', () => {
    const text = serializeMotionFile(meta, code);
    expect(text.startsWith('/* kinora-motion\n')).toBe(true);
    const back = parseMotionFile(text);
    expect(back.meta).toEqual(meta);
    expect(back.code).toBe(code);
  });

  it('replaces an existing header instead of stacking them', () => {
    const once = serializeMotionFile(meta, code);
    const twice = serializeMotionFile({ ...meta, duration: 8 }, once);
    expect(twice.match(/kinora-motion/g)).toHaveLength(1);
    expect(parseMotionFile(twice).meta.duration).toBe(8);
    expect(parseMotionFile(twice).code).toBe(code);
  });

  it('reads files without a header, with a BOM, or with a broken header', () => {
    expect(parseMotionFile(code)).toEqual({ meta: {}, code });
    expect(parseMotionFile(`﻿${serializeMotionFile(meta, code)}`).meta.name).toBe('Intro');
    expect(parseMotionFile(`/* kinora-motion\n{ not json\n*/\n${code}`)).toEqual({ meta: {}, code });
  });

  it('cannot be broken by a name containing the end of a comment', () => {
    const text = serializeMotionFile({ ...meta, name: 'a */ alert(1) /*' }, code);
    expect(parseMotionFile(text).code).toBe(code);
  });

  it('fills in and clamps settings', () => {
    const m = normalizeMotionMeta({ duration: 9999, fps: -1, width: 99999, images: { ok: 'as_2', 'bad name': 'x', n: 5 as unknown as string } }, { width: 1280, height: 720, fps: 25, name: 'Clip' });
    expect(m).toEqual({ name: 'Clip', width: 4096, height: 720, duration: 600, fps: 1, seed: 1, images: { ok: 'as_2' } });
    expect(normalizeMotionMeta({}, { width: 1080, height: 1920, fps: 30 })).toMatchObject({ width: 1080, height: 1920, fps: 30, duration: 5, name: 'Motion' });
  });
});

describe('Motion guide and bundle', () => {
  const guide = motionGuide();
  const importMap = readFileSync('scripts/build-motion.mjs', 'utf8');

  it('documents every library, font and example', () => {
    for (const lib of MOTION_LIBRARIES) expect(guide).toContain(lib.name);
    for (const font of MOTION_FONTS) expect(guide).toContain(font);
    for (const ex of MOTION_EXAMPLES) {
      expect(guide).toContain(ex.code);
      expect(ex.code).toMatch(/export default (async )?function setup\(k\)/);
    }
  });

  it('lists only libraries the runtime actually serves', () => {
    for (const lib of MOTION_LIBRARIES) for (const spec of lib.imports.filter((s) => !s.includes('…'))) {
      const bare = spec.split('/')[0];
      expect(importMap.includes(`'${bare}'`) || importMap.includes(`${bare}:`) || importMap.includes(`'${spec}'`) || spec.startsWith('gsap/') || spec.startsWith('three/')).toBe(true);
    }
  });

  it('documents every three.js addon that is bundled (and only those)', () => {
    const bundled = [...readFileSync('src/motion/lib/three-addons.ts', 'utf8').matchAll(/from 'three\/addons\/[\w-]+\/(\w+)\.js'/g)].map((m) => m[1]);
    for (const name of new Set(bundled)) if (name !== 'Pass' && name !== 'BufferGeometryUtils') expect(guide).toContain(name);
  });

  it('documents every GSAP plugin that is registered', () => {
    const plugins = [...readFileSync('src/motion/lib/gsap.ts', 'utf8').matchAll(/import \{ (\w+)[^}]*\} from 'gsap\/\w+'/g)].map((m) => m[1]);
    for (const p of plugins) if (p !== 'EasePack') expect(guide).toContain(p);
  });

  it('every font in the guide is bundled by the app', () => {
    const fonts = readFileSync('src/renderer/src/styles/fonts.ts', 'utf8');
    for (const f of MOTION_FONTS) {
      const pkg = f.replace(/ Variable$/, '').toLowerCase().replace(/ /g, '-');
      expect(fonts).toContain(pkg);
    }
  });
});
