/** Sumber tunggal tipe rasio dan jenis media ada di `@saa/domain`. */
import type { AspectRatio, MediaKind } from '@saa/domain';
export type { AspectRatio, MediaKind };

export interface MediaGenerationRequest {
  /** Default `video` agar pemanggil lama tidak perlu berubah (ADR-0012). */
  kind?: MediaKind;
  prompt: string;
  aspectRatio: AspectRatio;
  outputDirectory: string;
  correlationId: string;
}

export interface GeneratedMedia {
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Hanya diisi untuk video. */
  durationMs?: number;
}

export interface MediaGenerator {
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;
  generate(request: MediaGenerationRequest): Promise<GeneratedMedia>;
}

export interface ProbeResult {
  durationMs: number | null;
  available: boolean;
}

export interface MediaProbe {
  probe(filePath: string): Promise<ProbeResult>;
}
