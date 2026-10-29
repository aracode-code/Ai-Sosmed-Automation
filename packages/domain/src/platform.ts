export const PLATFORM_IDS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'x',
  'threads'
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
