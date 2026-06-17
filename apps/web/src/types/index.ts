export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'online_assessment'
  | 'phone_interview'
  | 'technical_interview'
  | 'onsite'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted';

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  screening: 'Screening',
  online_assessment: 'Online Assessment',
  phone_interview: 'Phone Interview',
  technical_interview: 'Technical Interview',
  onsite: 'Onsite',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

export const PIPELINE_STATUSES: ApplicationStatus[] = [
  'applied',
  'screening',
  'online_assessment',
  'phone_interview',
  'technical_interview',
  'onsite',
  'offer',
];

export const TERMINAL_STATUSES: ApplicationStatus[] = ['accepted', 'rejected', 'withdrawn', 'ghosted'];

export interface SalaryRange {
  min: number;
  max: number;
  currency: string;
}

export type StatusEventSource =
  | 'created'
  | 'manual'
  | 'email_auto'
  | 'email_confirmed'
  | 'auto_ghosted'
  | 'backfill';

export interface StatusEvent {
  status: ApplicationStatus;
  at: string; // ISO timestamp of the transition
  source: StatusEventSource;
}

export interface Application {
  appId: string;
  company: string;
  role: string;
  jobUrl?: string;
  status: ApplicationStatus;
  appliedAt: string;
  salaryRange?: SalaryRange;
  notes?: string;
  resumeVersionId?: string;
  lastActivityAt: string;
  ghostedAt?: string;
  /** Append-only log of status transitions, oldest first. Server-managed. */
  statusHistory?: StatusEvent[];
}

export interface ResumeVersion {
  versionId: string;
  label: string;
  s3Key: string;
  uploadedAt: string;
  useCount: number;
}

export type EmailClassification =
  | 'rejection'
  | 'interview_request'
  | 'recruiter_outreach'
  | 'job_alert'
  | 'offer'
  | 'follow_up_needed'
  | 'unrelated';

export interface EmailEvent {
  emailId: string;   // = gmailMsgId
  gmailMsgId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  classification: EmailClassification;
  confidence: number;
  applicationId?: string;
  suggestedStatus?: ApplicationStatus;
  /** For follow_up_needed: a short to-do extracted from the email. */
  actionSummary?: string;
  /** For follow_up_needed: due date as YYYY-MM-DD, if the email stated one. */
  actionDeadline?: string;
  needsReview: boolean;
  reviewed: boolean;
}
