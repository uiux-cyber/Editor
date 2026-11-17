/**
 * Proxy rules (pure): which sources are heavy enough to deserve a lightweight editing copy,
 * how big the proxy is, and where it is stored. Unit-tested in tests/media.test.ts.
 */

import { hashString, safeStem } from '@shared/media';
import type { MediaAsset } from '@/core/types';

export interface ProxyRules {
  /** Shorter side (px) from which a source is heavy (e.g. 1440 → 2560×1440 and above). */
  minShortSide: number;
  /** Average bitrate (Mbit/s) from which a source is heavy. */
  minMbps: number;
  /** 10-bit HEVC is heavy at any size. */
  hevc10: boolean;
}

export interface Eligibility {
  eligible: boolean;
  /** Human-readable reasons, e.g. ['2160p', '10-bit HEVC']. */
  reasons: string[];
}

/** True when an RFC 6381 codec string describes 10-bit (or deeper) HEVC: Main 10 / RExt profiles. */
export function isHevc10Bit(codecString: string | null | undefined): boolean {
  if (!codecString) return false;
  const m = /^(hev1|hvc1)\.([A-C]?)(\d+)\./i.exec(codecString);
  if (!m) return false;
  const profile = Number(m[3]);
  // 2 = Main 10, 4 = Range extensions (typically 4:2:2 / 10-bit+).
  return profile === 2 || profile === 4;
}

/** Average bitrate of a file in Mbit/s (0 when unknown). */
export function averageMbps(asset: Pick<MediaAsset, 'size' | 'duration'>): number {
  return asset.duration > 0 && asset.size > 0 ? (asset.size * 8) / asset.duration / 1e6 : 0;
}

export function proxyEligibility(asset: MediaAsset, rules: ProxyRules, codecString?: string | null): Eligibility {
  const reasons: string[] = [];
  if (asset.kind !== 'video' || !asset.hasVideo || asset.source.type !== 'file') return { eligible: false, reasons };
  const short = Math.min(asset.width, asset.height);
  if (short >= rules.minShortSide) reasons.push(`${short}p`);
  const mbps = averageMbps(asset);
  if (rules.minMbps > 0 && mbps >= rules.minMbps) reasons.push(`${Math.round(mbps)} Mbit/s`);
  if (rules.hevc10 && asset.videoCodec === 'hevc' && isHevc10Bit(codecString)) reasons.push('10-bit HEVC');
  return { eligible: reasons.length > 0, reasons };
}

/** Even proxy dimensions whose shorter side is `size` (never upscales). */
export function proxyDimensions(width: number, height: number, size: number): { width: number; height: number } {
  const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);
  if (!(width > 0 && height > 0)) return { width: even(size * (16 / 9)), height: even(size) };
  const k = Math.min(1, size / Math.min(width, height));
  return { width: even(width * k), height: even(height * k) };
}

/** Proxy video bitrate (bit/s): generous for H.264 at small sizes so the proxy looks clean. */
export function proxyBitrate(width: number, height: number, fps: number): number {
  const f = Math.min(60, Math.max(1, fps || 30));
  return Math.round(Math.min(12e6, Math.max(1.2e6, width * height * f * 0.16)));
}

/** File name of the proxy of a source (stable across sessions and projects). */
export function proxyFileName(asset: Pick<MediaAsset, 'name' | 'source' | 'size'>, size: number): string {
  const src = asset.source.type === 'file' ? asset.source.path.toLowerCase() : asset.name;
  return `${safeStem(asset.name, 40)}-${size}p-${hashString(`${src}|${asset.size}|${size}`).slice(0, 12)}.mp4`;
}
