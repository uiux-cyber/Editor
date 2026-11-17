/**
 * HDR → SDR tone-mapping for HDR video layers (PQ / HLG, BT.2020). Runs at the `source` stage on
 * the raw signal that Chromium hands to WebGL (see engine/media/hdr.ts), so the preview, the
 * render cache and the export apply exactly the same curve. Off for SDR media: the branch is
 * skipped and SDR pixels are untouched (bit-identical).
 */

import type { ToneMapSettings } from '@/core/types';
import { HDR_GLSL, OPERATOR_INDEX, SDR_WHITE_NITS } from '../hdrMath';
import type { LayerExtension } from '../layerExt';
import { hdrInfoById, hdrPassthrough } from '../../media/hdr';

export const DEFAULT_TONE_MAP: ToneMapSettings = { operator: 'bt2390', exposure: 0, peak: 1000 };

const ext: LayerExtension = {
  id: 'hdr',
  stage: 'source',
  order: 10,
  decls: `
uniform int u_ext_hdr_transfer;  // 0 = PQ, 1 = HLG
uniform int u_ext_hdr_op;
uniform float u_ext_hdr_gain;     // exposure as a linear factor
uniform float u_ext_hdr_peak;     // source peak relative to SDR white
uniform float u_ext_hdr_gamut;    // 1 = convert BT.2020 → BT.709
${HDR_GLSL}`,
  body: `
    vec3 lin;
    if (u_ext_hdr_transfer == 0) {
      lin = ext_hdr_pqDecode(rgb) / ext_hdr_WHITE;
    } else {
      // HLG: inverse OETF, then the system OOTF (γ 1.2 at a 1000-nit nominal peak).
      vec3 sceneLin = ext_hdr_hlgDecode(rgb);
      float ys = dot(sceneLin, vec3(0.2627, 0.6780, 0.0593));
      lin = sceneLin * pow(max(ys, 1e-6), 0.2) * (1000.0 / ext_hdr_WHITE);
    }
    if (u_ext_hdr_gamut > 0.5) lin = ext_hdr_2020to709 * lin;
    lin = max(lin, 0.0) * u_ext_hdr_gain;
    // Hue-preserving: map the brightest channel and scale the others with it.
    float mx = max(max(lin.r, lin.g), lin.b);
    float mapped = ext_hdr_map1(u_ext_hdr_op, mx, u_ext_hdr_peak);
    rgb = ext_hdr_srgbEncode(mx > 0.0 ? lin * (mapped / mx) : vec3(0.0));`,
  apply: ({ gl, prog, clip, identity }) => {
    if (identity || clip.type !== 'video') return false;
    const info = hdrInfoById(clip.assetId);
    if (!info || !hdrPassthrough()) return false;
    const tm = clip.toneMap ?? DEFAULT_TONE_MAP;
    gl.uniform1i(prog.loc('u_ext_hdr_transfer'), info.transfer === 'hlg' ? 1 : 0);
    gl.uniform1i(prog.loc('u_ext_hdr_op'), OPERATOR_INDEX[tm.operator] ?? OPERATOR_INDEX.bt2390);
    gl.uniform1f(prog.loc('u_ext_hdr_gain'), Math.pow(2, Math.min(4, Math.max(-4, tm.exposure || 0))));
    gl.uniform1f(prog.loc('u_ext_hdr_peak'), Math.min(10000, Math.max(200, tm.peak || 1000)) / SDR_WHITE_NITS);
    gl.uniform1f(prog.loc('u_ext_hdr_gamut'), info.wideGamut ? 1 : 0);
    return true;
  },
};

export default ext;
