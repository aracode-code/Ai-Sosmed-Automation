import { describe, expect, it } from 'vitest';
import { aspectRatioForTargets } from './aspect';

describe('aspectRatioForTargets', () => {
  it('TikTok, Instagram, Threads selalu 9:16', () => {
    expect(aspectRatioForTargets([{ platform: 'tiktok' }])).toBe('9:16');
    expect(aspectRatioForTargets([{ platform: 'instagram', contentFormat: 'feed' }])).toBe('9:16');
    expect(aspectRatioForTargets([{ platform: 'threads' }])).toBe('9:16');
  });

  it('YouTube dan Facebook 16:9 kecuali format short/reel', () => {
    expect(aspectRatioForTargets([{ platform: 'youtube', contentFormat: 'video' }])).toBe('16:9');
    expect(aspectRatioForTargets([{ platform: 'youtube', contentFormat: 'short' }])).toBe('9:16');
    expect(aspectRatioForTargets([{ platform: 'facebook', contentFormat: 'reel' }])).toBe('9:16');
  });

  it('X memakai 16:9', () => {
    expect(aspectRatioForTargets([{ platform: 'x' }])).toBe('16:9');
  });

  it('campuran vertikal + horizontal dijatuhkan ke 9:16', () => {
    expect(
      aspectRatioForTargets([
        { platform: 'tiktok' },
        { platform: 'youtube', contentFormat: 'video' }
      ])
    ).toBe('9:16');
  });

  it('tanpa target memakai default mobile-first 9:16', () => {
    expect(aspectRatioForTargets([])).toBe('9:16');
  });
});
