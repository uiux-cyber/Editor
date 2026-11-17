/**
 * Vision feature area (on-device MediaPipe models + classic computer vision):
 * background removal, auto-reframe, scene detection, colour match and motion tracking.
 *
 * Importing this module registers the auto-reframe focus provider and exposes a debug handle
 * (`window.__kinoraVision`) used by the end-to-end tests.
 */

import * as client from './client';
import * as colorMatch from './colorMatch';
import * as cutout from './cutout';
import * as reframe from './reframe';
import * as scenes from './scenes';
import { applyVisionSettings } from './settings';
import { useVision } from './store';
import * as tracking from './tracking';

export const visionDebug = { client, colorMatch, cutout, reframe, scenes, tracking, useVision };

(window as unknown as Record<string, unknown>).__kinoraVision = visionDebug;
void applyVisionSettings();

export { client, colorMatch, cutout, reframe, scenes, tracking, useVision };
