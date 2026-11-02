export const JOB_TYPES = [
  'PLAN_CONTENT',
  'GENERATE_VIDEO',
  'GENERATE_IMAGE',
  'DOWNLOAD_VIDEO',
  'VALIDATE_MEDIA',
  'CREATE_METADATA',
  'REQUEST_APPROVAL',
  'PUBLISH',
  'VERIFY_PUBLICATION',
  'RECONCILE_PUBLICATION'
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'DOWNLOADING',
  'VALIDATING',
  'AWAITING_APPROVAL',
  'SCHEDULED',
  'PUBLISHING',
  'VERIFYING',
  'PUBLISHED',
  'COMPLETED',
  'RETRY_WAIT',
  'NEEDS_ATTENTION',
  'FAILED',
  'CANCELLED'
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  'PUBLISHED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActiveStatus(status: JobStatus): boolean {
  return !isTerminalStatus(status);
}
