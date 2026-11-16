import { linear, makeGenerator, makeShape } from '@/core/factory';
import type { TemplateDef } from '../types';
import { body, heading, safeArea, stack } from './_lib/kit';

/**
 * Reference template. Shows the house style for designs:
 *  - lay out from `env.cw` / `env.ch` and the safe area,
 *  - take colours from `env.palette` and type from `env.fonts` (via the kit),
 *  - measure text and stack blocks so nothing overlaps whatever the font or line count,
 *  - stagger entrances and give every layer an exit.
 */
const templates: TemplateDef[] = [
  {
    id: 'clean-title-card',
    name: 'Clean Title Card',
    category: 'title',
    tags: ['title', 'minimal', 'opener'],
    duration: 5,
    poster: 0.5,
    build: (env) => {
      const { palette: c, duration: d } = env;
      const safe = safeArea(env);
      const width = Math.min(safe.w, 1500);

      const title = heading(env, 'YOUR TITLE HERE', {
        name: 'Title',
        start: 0.4,
        duration: d - 0.4,
        size: env.portrait ? 150 : 168,
        maxWidth: width,
        maxLines: 2,
        textAnim: { in: { id: 'char-rise-in', duration: 0.9 } },
        anim: { out: { id: 'fade-out', duration: 0.4 } },
      });
      const subtitle = body(env, 'A short supporting line goes here', {
        name: 'Subtitle',
        start: 0.9,
        duration: d - 0.9,
        size: 46,
        color: c.textMuted,
        maxWidth: width,
        maxLines: 2,
        anim: { in: { id: 'slide-up-in', duration: 0.6 }, out: { id: 'fade-out', duration: 0.4 } },
      });
      const bar = makeShape('rect', {
        name: 'Accent bar',
        start: 0.3,
        duration: d - 0.3,
        width: 180,
        height: 10,
        radius: 5,
        fill: linear(0, c.primary, c.secondary),
        anim: { in: { id: 'wipe-right-in', duration: 0.6 }, out: { id: 'fade-out', duration: 0.4 } },
      });
      stack(
        [
          { clip: bar, height: 10, gap: 36 },
          { clip: title, height: title.metrics.height, gap: 30 },
          { clip: subtitle, height: subtitle.metrics.height },
        ],
        { centerY: 0 },
      );

      return [
        makeGenerator('aurora', {
          duration: d,
          params: { colorA: c.primary, colorB: c.secondary, colorC: c.accent, colorBg: c.bg, speed: 0.8 },
        }),
        bar,
        title,
        subtitle,
      ];
    },
  },
];

export default templates;
