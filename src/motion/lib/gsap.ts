// GSAP and its plugins for Motion clips, driven by the clip clock (see ../runtime.ts).
// GSAP is distributed under the GSAP Standard License (https://gsap.com/standard-license).
import { gsap } from 'gsap';
import { CustomBounce } from 'gsap/CustomBounce';
import { CustomEase } from 'gsap/CustomEase';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { EasePack, ExpoScaleEase, RoughEase, SlowMo } from 'gsap/EasePack';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { Physics2DPlugin } from 'gsap/Physics2DPlugin';
import { PhysicsPropsPlugin } from 'gsap/PhysicsPropsPlugin';
import { PixiPlugin } from 'gsap/PixiPlugin';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';
import { TextPlugin } from 'gsap/TextPlugin';

gsap.registerPlugin(CustomEase, CustomBounce, CustomWiggle, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, Physics2DPlugin, PhysicsPropsPlugin, PixiPlugin, ScrambleTextPlugin, SplitText, TextPlugin);

// Tweens follow the clip clock: Kinora renders frames in any order, so the root timeline is set
// to the frame time instead of advancing on its own.
const host = (globalThis as unknown as { __kinoraMotion?: { onTime(fn: (t: number) => void): void } }).__kinoraMotion;
if (host) {
  gsap.ticker.remove(gsap.updateRoot);
  gsap.ticker.lagSmoothing(0);
  host.onTime((t) => gsap.updateRoot(t));
}

export * from 'gsap';
export { gsap, gsap as default, CustomBounce, CustomEase, CustomWiggle, DrawSVGPlugin, EasePack, ExpoScaleEase, MorphSVGPlugin, MotionPathPlugin, Physics2DPlugin, PhysicsPropsPlugin, PixiPlugin, RoughEase, ScrambleTextPlugin, SlowMo, SplitText, TextPlugin };
