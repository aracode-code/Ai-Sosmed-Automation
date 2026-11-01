export interface Health {
  status: string;
  version: string;
  db: string;
  workers: { active: number };
  time: string;
}

export interface Job {
  id: string;
  campaignId: string | null;
  contentId: string | null;
  parentJobId: string | null;
  jobType: string;
  status: string;
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

export interface Campaign {
  id: string;
  name: string;
  niche: string;
  status: string;
  approvalMode: 'automatic' | 'required';
  platforms: string[];
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

export interface AccountSummary {
  id: string;
  platform: string;
  label: string;
  connectionStatus: 'connected' | 'reauth_required' | 'disconnected';
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface CampaignDetail {
  campaign: Campaign;
  content: ContentItem[];
}

export interface AssetSummary {
  id: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  validationStatus: 'pending' | 'valid' | 'invalid';
}

/** Respons GET /api/v1/content/:id — bahan dialog approval. */
export interface ContentDetail {
  content: ContentItem;
  campaign: {
    id: string;
    name: string;
    platforms: string[];
    approvalMode: string;
    status: string;
  };
  assets: AssetSummary[];
  captionHash: string;
  accounts: AccountSummary[];
}

export interface ApprovalRecord {
  id: string;
  decision: 'approved' | 'rejected';
}

/** Respons GET /api/v1/dashboard/summary. */
export interface DashboardSummary {
  generatedAt: string;
  jobs: { total: number; byStatus: Record<string, number> };
  publishAttempts: { total: number; byStatus: Record<string, number> };
  campaigns: { total: number; byStatus: Record<string, number> };
  content: { total: number; byApprovalStatus: Record<string, number>; pendingApproval: number };
  accounts: { total: number; byConnectionStatus: Record<string, number> };
  recentFailures: {
    id: string;
    jobType: string;
    status: string;
    lastErrorCode: string | null;
    updatedAt: string;
  }[];
}
