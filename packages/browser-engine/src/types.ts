/** Sumber tunggal tipe rasio ada di `@saa/domain` (ADR-0010 F19). */
import type { AspectRatio } from '@saa/domain';
export type { AspectRatio };

export interface VideoGenerationRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  outputDirectory: string;
  correlationId: string;
}

export interface GeneratedVideo {
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationMs?: number;
}

export interface VideoGenerator {
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;
  generate(request: VideoGenerationRequest): Promise<GeneratedVideo>;
}

export interface ProbeResult {
  durationMs: number | null;
  available: boolean;
}

export interface MediaProbe {
  probe(filePath: string): Promise<ProbeResult>;
}
