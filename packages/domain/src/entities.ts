import type { JobStatus, JobType } from './job';
import type { PlatformId } from './platform';

export interface Campaign {
  id: string;
  name: string;
  niche: string;
  status: string;
  approvalMode: 'automatic' | 'required';
  createdAt: string;
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
