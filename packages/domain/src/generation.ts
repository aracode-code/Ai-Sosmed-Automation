/**
 * Mode generasi ditentukan per campaign: satu campaign hanya memproduksi satu
 * jenis artefak agar rasio, model Flow, dan langkah publikasinya konsisten.
 */
export const GENERATION_MODES = ['video', 'image'] as const;

export type GenerationMode = (typeof GENERATION_MODES)[number];

/** Jenis artefak media; nilainya sama dengan mode generasi campaign. */
export type MediaKind = GenerationMode;

export function isGenerationMode(value: unknown): value is GenerationMode {
  return value === 'video' || value === 'image';
}
