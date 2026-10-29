import type { JobStatus, JobType } from './job';
import type { PlatformId } from './platform';

export interface Campaign {
  id: string;
  name: string;
  niche: string;
  status: string;
  approvalMode: 'automatic' | 'required';
  /** Target platform campaign; disimpan sebagai `platforms_json` (ADR-0003). */
  platforms: PlatformId[];
  createdAt: string;
}

export interface ContentItem {
  id: string;
  campaignId: string;
  version: number;
  topic: string;
  prompt: unknown;
  caption: unknown;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'not_required';
}

export interface MediaAsset {
  id: string;
  contentId: string;
  path: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  validationStatus: 'pending' | 'valid' | 'invalid';
}

export interface SocialAccount {
  id: string;
  platform: PlatformId;
  label: string;
  connectionStatus: 'connected' | 'reauth_required' | 'disconnected';
  secretRef: string | null;
  profileKey: string | null;
}

export interface Job {
  id: string;
  campaignId: string | null;
  contentId: string | null;
  parentJobId: string | null;
  jobType: JobType;
  status: JobStatus;
  payload: unknown;
  runAt: string | null;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseUntil: string | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: string;
  metadata: unknown;
  createdAt: string;
}
