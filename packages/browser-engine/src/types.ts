export type AspectRatio = '9:16' | '16:9' | '1:1';

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
