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

export type GenerationMode = 'video' | 'image';

export interface Campaign {
  id: string;
  name: string;
  niche: string;
  status: string;
  approvalMode: 'automatic' | 'required';
  generationMode: GenerationMode;
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
    generationMode: GenerationMode;
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

/** Respons GET /api/v1/plans/:jobId — bahan keputusan tingkat rencana. */
export interface PlanReviewContent {
  id: string;
  version: number;
  topic: string;
  caption: unknown;
  approvalStatus: ContentItem['approvalStatus'];
  mediaKind: GenerationMode;
}

export interface PlanApprovalRecord {
  id: string;
  planJobId: string;
  campaignId: string;
  bindingHash: string;
  itemCount: number;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  decidedBy: string;
  reason: string | null;
}

export interface PlanReview {
  plan: { jobId: string; campaignId: string; status: string };
  campaign: {
    id: string;
    name: string;
    platforms: string[];
    approvalMode: 'automatic' | 'required';
    generationMode: GenerationMode;
  } | null;
  contents: PlanReviewContent[];
  bindingHash: string;
  approval: PlanApprovalRecord | null;
}

/** Respons GET /api/v1/dashboard/summary. */
export interface DashboardSummary {
  generatedAt: string;
  jobs: { total: number; byStatus: Record<string, number> };
  publishAttempts: { total: number; byStatus: Record<string, number> };
  campaigns: { total: number; byStatus: Record<string, number> };
  content: { total: number; byApprovalStatus: Record<string, number>; pendingApproval: number };
  accounts: { total: number; byConnectionStatus: Record<string, number> };
  trend: { date: string; jobs: number; published: number; failed: number }[];
  recentFailures: {
    id: string;
    jobType: string;
    status: string;
    lastErrorCode: string | null;
    updatedAt: string;
  }[];
}

/** Respons GET /api/v1/connections. */
export interface FlowProbeStatus {
  reachable: boolean;
  pageOpen: boolean;
  promptPresent: boolean;
  submitPresent: boolean;
  challengeDetected: boolean;
  detail: string | null;
}

export interface ConnectionsPayload {
  generatedAt: string;
  flow: FlowProbeStatus & {
    adapter: 'mock' | 'real';
    cdpEndpoint: string;
    privacy: string;
    appStatus: string;
  };
  usage: {
    guard: { maxPerDay: number; requireConfirm: boolean; dryRun: boolean };
    usedToday: number;
    day: string;
  };
  accounts: {
    id: string;
    platform: string;
    label: string;
    connectionStatus: 'connected' | 'reauth_required' | 'disconnected';
    hasSecretRef: boolean;
  }[];
  platforms: { id: string; supported: boolean; adapter: string; generator: string | null }[];
}

export type ConnectActionKind = 'flow-login' | 'youtube-pair';

export type ConnectActionPhase =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

/** Status proses connect yang dijalankan dari UI (tanpa kredensial). */
export interface ConnectActionState {
  kind: ConnectActionKind;
  phase: ConnectActionPhase;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  waitingFor: string | null;
  error: string | null;
  lines: string[];
}

export interface ConnectActionsPayload {
  generatedAt: string;
  actions: { flowLogin: ConnectActionState; youtubePair: ConnectActionState };
}

/** Status kunci AI; nilainya sendiri tidak pernah dikirim ke UI. */
export interface AiCredentialStatusPayload {
  configured: boolean;
  source: 'store' | 'env' | 'none';
  storeError: boolean;
}

export interface JobTimeline {
  job: { id: string; status: string; jobType: string };
  events: {
    id: string;
    actorType: string;
    actorId: string | null;
    action: string;
    result: string;
    metadata: unknown;
    createdAt: string;
  }[];
  attempts: {
    id: string;
    accountId: string;
    platform: string;
    status: string;
    externalPostId: string | null;
    permalink: string | null;
    attemptedAt: string;
    verifiedAt: string | null;
    errorCode: string | null;
  }[];
}
