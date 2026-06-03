export type ApplicationStatus =
  | 'applied'
  | 'screening'
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
  needsReview: boolean;
  reviewed: boolean;
}
