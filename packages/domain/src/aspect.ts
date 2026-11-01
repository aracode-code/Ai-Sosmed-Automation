import type { PlatformId } from './platform';

/**
 * Policy rasio video per platform. Short-form vertikal (TikTok, Instagram/Reels,
 * Threads) selalu 9:16; YouTube/Facebook 16:9 kecuali formatnya short/reel;
 * X 16:9. Campuran vertikal+horizontal dijatuhkan ke 9:16 (mobile-first).
 */

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface AspectTarget {
  platform: PlatformId | string;
  contentFormat?: string;
}

const SHORT_FORMAT = /short|reel|story|klip|clip|vertikal|vertical/i;

function ratioForTarget(target: AspectTarget): AspectRatio {
  const shortForm = target.contentFormat !== undefined && SHORT_FORMAT.test(target.contentFormat);
  switch (target.platform) {
    case 'tiktok':
    case 'instagram':
    case 'threads':
      return '9:16';
    case 'youtube':
    case 'facebook':
      return shortForm ? '9:16' : '16:9';
    case 'x':
      return '16:9';
    default:
      return '9:16';
  }
}

export function aspectRatioForTargets(targets: AspectTarget[]): AspectRatio {
  if (targets.length === 0) return '9:16';

  const ratios = targets.map(ratioForTarget);
  if (ratios.every((ratio) => ratio === '16:9')) return '16:9';
  return '9:16';
}
