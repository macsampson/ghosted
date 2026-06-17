import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GetCommand, QueryCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { cleanActionFields, processRecord, VALID_STATUSES } from '../handlers/classifier';
import { ddb, TABLE_NAME, keys } from '../lib/dynamo';

// Mock Anthropic before importing classifier internals
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn(),
      }),
    })),
  };
});

// The pure helpers are not exported from classifier.ts, so we test the logic
// directly here rather than through the Lambda handler (which requires SQS context).

// ---------- extractSenderDomain ----------

function extractSenderDomain(sender: string): string {
  const match = sender.match(/@([\w.-]+)/);
  if (!match) return '';
  const parts = match[1].split('.');
  return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : '';
}

describe('extractSenderDomain', () => {
  it('extracts domain from a plain email address', () => {
    expect(extractSenderDomain('recruiter@stripe.com')).toBe('stripe');
  });

  it('extracts domain from a display-name email', () => {
    expect(extractSenderDomain('Jane Smith <jane@greenhouse.io>')).toBe('greenhouse');
  });

  it('handles subdomains correctly', () => {
    expect(extractSenderDomain('noreply@mail.lever.co')).toBe('lever');
  });

  it('returns empty string for unrecognisable input', () => {
    expect(extractSenderDomain('not-an-email')).toBe('');
  });
});

// ---------- domainMatchesCompany ----------

function domainMatchesCompany(domain: string, company: string): boolean {
  if (!domain || domain.length < 3) return false;
  const words = company.toLowerCase().split(/[\s,&.()\-]+/).filter(w => w.length >= 3);
  return words.some(word => word === domain || word.startsWith(domain));
}

describe('domainMatchesCompany', () => {
  it('matches when company name contains the domain', () => {
    expect(domainMatchesCompany('stripe', 'Stripe')).toBe(true);
    expect(domainMatchesCompany('stripe', 'Stripe, Inc.')).toBe(true);
  });

  it('does not match an unrelated company', () => {
    expect(domainMatchesCompany('lever', 'Stripe')).toBe(false);
  });

  it('returns false for empty domain', () => {
    expect(domainMatchesCompany('', 'Stripe')).toBe(false);
  });

  it('does not match when domain is shorter than 3 chars', () => {
    expect(domainMatchesCompany('io', 'Notion')).toBe(false);
  });

  it('matches a domain that is a prefix of a company word', () => {
    // 'green' should match 'Greenhouse' (word starts with 'green')
    expect(domainMatchesCompany('green', 'Greenhouse')).toBe(true);
  });
});



// ---------- LLM provider selection ----------

function selectLLMProvider(
  geminiKey: string | null,
  claudeKey: string | null,
): 'gemini' | 'claude' | 'ollama' {
  if (geminiKey) return 'gemini';
  if (claudeKey) return 'claude';
  return 'ollama';
}

describe('selectLLMProvider', () => {
  it('prefers gemini when both keys are present', () => {
    expect(selectLLMProvider('gemini-key', 'claude-key')).toBe('gemini');
  });

  it('falls back to claude when gemini key is absent', () => {
    expect(selectLLMProvider(null, 'claude-key')).toBe('claude');
  });

  it('falls back to ollama when both keys are absent', () => {
    expect(selectLLMProvider(null, null)).toBe('ollama');
  });

  it('uses gemini when only gemini key is present', () => {
    expect(selectLLMProvider('gemini-key', null)).toBe('gemini');
  });
});

// ---------- auto-create logic ----------

interface NewApplicationData {
  company: string;
  role: string | null;
  jobUrl: string | null;
  notes: string | null;
}

const AUTO_CREATE_CLASSIFICATIONS = new Set(['rejection', 'interview_request', 'offer', 'follow_up_needed', 'application_acknowledged']);

function shouldAutoCreate(
  classification: string,
  applicationId: string | null,
  newApplication: NewApplicationData | null,
): boolean {
  return (
    applicationId === null &&
    newApplication !== null &&
    AUTO_CREATE_CLASSIFICATIONS.has(classification)
  );
}

describe('shouldAutoCreate', () => {
  const newApp: NewApplicationData = { company: 'Acme Corp', role: 'Engineer', jobUrl: null, notes: null };

  it('creates when rejection has no matched app and newApplication is set', () => {
    expect(shouldAutoCreate('rejection', null, newApp)).toBe(true);
  });

  it('creates when interview_request has no matched app', () => {
    expect(shouldAutoCreate('interview_request', null, newApp)).toBe(true);
  });

  it('creates when offer has no matched app', () => {
    expect(shouldAutoCreate('offer', null, newApp)).toBe(true);
  });

  it('creates when follow_up_needed has no matched app', () => {
    expect(shouldAutoCreate('follow_up_needed', null, newApp)).toBe(true);
  });

  it('does not create when applicationId is already matched', () => {
    expect(shouldAutoCreate('rejection', 'app-123', newApp)).toBe(false);
  });

  it('does not create when newApplication is null', () => {
    expect(shouldAutoCreate('rejection', null, null)).toBe(false);
  });

  it('creates when application_acknowledged has no matched app', () => {
    expect(shouldAutoCreate('application_acknowledged', null, newApp)).toBe(true);
  });

  it('does not create for recruiter_outreach', () => {
    expect(shouldAutoCreate('recruiter_outreach', null, newApp)).toBe(false);
  });

  it('does not create for job_alert', () => {
    expect(shouldAutoCreate('job_alert', null, newApp)).toBe(false);
  });

  it('does not create for unrelated', () => {
    expect(shouldAutoCreate('unrelated', null, newApp)).toBe(false);
  });
});

// ---------- rejection auto-create notes ----------

const REJECTION_DATE_NOTE = 'Application date estimated from rejection email — actual apply date unknown.';

function buildAutoCreateNotes(llmNotes: string | null, initialStatus: string): string | null {
  const dateNote = initialStatus === 'rejected' ? REJECTION_DATE_NOTE : null;
  return [llmNotes, dateNote].filter(Boolean).join(' ') || null;
}

describe('buildAutoCreateNotes', () => {
  it('adds the date caveat for a rejection with no LLM notes', () => {
    expect(buildAutoCreateNotes(null, 'rejected')).toBe(REJECTION_DATE_NOTE);
  });

  it('appends the date caveat to existing LLM notes for a rejection', () => {
    expect(buildAutoCreateNotes('Senior role.', 'rejected')).toBe(
      `Senior role. ${REJECTION_DATE_NOTE}`,
    );
  });

  it('returns null for non-rejection status with no LLM notes', () => {
    expect(buildAutoCreateNotes(null, 'applied')).toBeNull();
  });

  it('returns only LLM notes for non-rejection status', () => {
    expect(buildAutoCreateNotes('Some note.', 'applied')).toBe('Some note.');
  });
});

// ---------- suggestedStatus sanitization ----------

function sanitizeSuggestedStatus(
  classification: string,
  suggestedStatus: string | null,
): string | null {
  if (classification === 'application_acknowledged') return null;
  return suggestedStatus;
}

describe('sanitizeSuggestedStatus', () => {
  it('nulls suggestedStatus for application_acknowledged regardless of LLM value', () => {
    expect(sanitizeSuggestedStatus('application_acknowledged', 'screening')).toBeNull();
    expect(sanitizeSuggestedStatus('application_acknowledged', 'applied')).toBeNull();
    expect(sanitizeSuggestedStatus('application_acknowledged', null)).toBeNull();
  });

  it('leaves suggestedStatus unchanged for other classifications', () => {
    expect(sanitizeSuggestedStatus('rejection', 'rejected')).toBe('rejected');
    expect(sanitizeSuggestedStatus('interview_request', 'screening')).toBe('screening');
    expect(sanitizeSuggestedStatus('offer', 'offer')).toBe('offer');
    expect(sanitizeSuggestedStatus('follow_up_needed', null)).toBeNull();
  });

  it('allows follow_up_needed to carry a screening suggestion (recruiter initial contact)', () => {
    // Unlike application_acknowledged, follow_up_needed is NOT force-nulled — a
    // recruiter responding to a submitted application to set up a screen is a real
    // screening signal the user can confirm in the review queue.
    expect(sanitizeSuggestedStatus('follow_up_needed', 'screening')).toBe('screening');
  });
});

// ---------- VALID_STATUSES ----------

describe('VALID_STATUSES', () => {
  it('accepts online_assessment as a suggestable pipeline status', () => {
    // An assessment/OA invite is a follow_up_needed action item that suggests
    // moving the application to online_assessment — so the status must survive
    // the VALID_STATUSES sanitization that nulls unknown LLM values.
    expect(VALID_STATUSES.has('online_assessment')).toBe(true);
  });
});

// ---------- action-field extraction (follow_up_needed) ----------

describe('cleanActionFields', () => {
  it('extracts a trimmed action summary and a valid deadline for follow_up_needed', () => {
    expect(cleanActionFields('follow_up_needed', '  Complete the HackerRank assessment  ', '2026-06-15')).toEqual({
      actionSummary: 'Complete the HackerRank assessment',
      actionDeadline: '2026-06-15',
    });
  });

  it('keeps the action summary but nulls a malformed deadline', () => {
    expect(cleanActionFields('follow_up_needed', 'Send three references', 'next Friday')).toEqual({
      actionSummary: 'Send three references',
      actionDeadline: null,
    });
  });

  it('nulls an empty or whitespace-only summary', () => {
    expect(cleanActionFields('follow_up_needed', '   ', null)).toEqual({
      actionSummary: null,
      actionDeadline: null,
    });
  });

  it('extracts action fields for recruiter_outreach (a lead to respond to)', () => {
    // recruiter_outreach is now an action item alongside follow_up_needed: a
    // recruiter pinging about an un-applied role is something to reply to, surfaced
    // in "Action needed" rather than ignored or auto-created as an application.
    expect(cleanActionFields('recruiter_outreach', '  Reply to recruiter about Backend role  ', '2026-06-20')).toEqual({
      actionSummary: 'Reply to recruiter about Backend role',
      actionDeadline: '2026-06-20',
    });
  });

  it('always nulls both fields for non-action classifications', () => {
    expect(cleanActionFields('rejection', 'Do something', '2026-06-15')).toEqual({
      actionSummary: null,
      actionDeadline: null,
    });
    expect(cleanActionFields('interview_request', 'Schedule call', '2026-06-15')).toEqual({
      actionSummary: null,
      actionDeadline: null,
    });
    expect(cleanActionFields('application_feedback', 'Take survey', '2026-06-15')).toEqual({
      actionSummary: null,
      actionDeadline: null,
    });
  });

  it('tolerates non-string inputs from the LLM', () => {
    expect(cleanActionFields('follow_up_needed', 42 as unknown as string, {} as unknown as string)).toEqual({
      actionSummary: null,
      actionDeadline: null,
    });
  });
});

// ---------- auto-create confidence gate ----------

describe('shouldAutoCreate — confidence gate', () => {
  const newApp: NewApplicationData = { company: 'Acme Corp', role: 'Engineer', jobUrl: null, notes: null };

  function shouldAutoCreate(
    classification: string,
    applicationId: string | null,
    newApplication: NewApplicationData | null,
    confidence: number,
  ): boolean {
    return (
      applicationId === null &&
      newApplication !== null &&
      AUTO_CREATE_CLASSIFICATIONS.has(classification) &&
      confidence >= 0.8
    );
  }

  it('creates when confidence is at or above threshold', () => {
    expect(shouldAutoCreate('application_acknowledged', null, newApp, 0.9)).toBe(true);
    expect(shouldAutoCreate('application_acknowledged', null, newApp, 0.8)).toBe(true);
    expect(shouldAutoCreate('rejection', null, newApp, 0.85)).toBe(true);
  });

  it('does not create when confidence is below threshold', () => {
    expect(shouldAutoCreate('application_acknowledged', null, newApp, 0.7)).toBe(false);
    expect(shouldAutoCreate('rejection', null, newApp, 0.5)).toBe(false);
    expect(shouldAutoCreate('interview_request', null, newApp, 0.79)).toBe(false);
  });

  it('does not create when applicationId is already matched regardless of confidence', () => {
    expect(shouldAutoCreate('rejection', 'app-123', newApp, 0.95)).toBe(false);
  });

  it('does not create when newApplication is null regardless of confidence', () => {
    expect(shouldAutoCreate('rejection', null, null, 0.95)).toBe(false);
  });
});

// ---------- needsReview logic ----------

function needsReview(
  autoApply: boolean,
  wasAutoCreated: boolean,
  classification: string,
): boolean {
  return (
    !autoApply &&
    !wasAutoCreated &&
    classification !== 'unrelated' &&
    classification !== 'job_alert' &&
    classification !== 'application_feedback'
  );
}

describe('needsReview', () => {
  it('does not need review when application was auto-created', () => {
    expect(needsReview(false, true, 'application_acknowledged')).toBe(false);
    expect(needsReview(false, true, 'rejection')).toBe(false);
  });

  it('does not need review when autoApply is true', () => {
    expect(needsReview(true, false, 'rejection')).toBe(false);
  });

  it('needs review when not auto-created and not auto-applied', () => {
    expect(needsReview(false, false, 'rejection')).toBe(true);
    expect(needsReview(false, false, 'interview_request')).toBe(true);
    expect(needsReview(false, false, 'application_acknowledged')).toBe(true);
    expect(needsReview(false, false, 'follow_up_needed')).toBe(true);
  });

  it('never needs review for unrelated, job_alert, or application_feedback', () => {
    expect(needsReview(false, false, 'unrelated')).toBe(false);
    expect(needsReview(false, false, 'job_alert')).toBe(false);
    expect(needsReview(false, false, 'application_feedback')).toBe(false);
  });

  it('needs review for recruiter_outreach (a lead to respond to, surfaced as an action item)', () => {
    // recruiter_outreach is no longer ignored: it's never auto-applied or
    // auto-created, so it falls through to review and shows up under "Action needed".
    expect(needsReview(false, false, 'recruiter_outreach')).toBe(true);
  });
});

// ---------- ignored-classification logic ----------

const IGNORE_CLASSIFICATIONS = new Set(['unrelated', 'job_alert', 'application_feedback']);

function isIgnored(classification: string): boolean {
  return IGNORE_CLASSIFICATIONS.has(classification);
}

describe('isIgnored', () => {
  it('ignores unrelated, job_alert, and application_feedback', () => {
    expect(isIgnored('unrelated')).toBe(true);
    expect(isIgnored('job_alert')).toBe(true);
    // application-process surveys ("rate your candidate experience") are dropped,
    // not auto-created as phantom applications.
    expect(isIgnored('application_feedback')).toBe(true);
  });

  it('does not ignore actionable classifications', () => {
    expect(isIgnored('rejection')).toBe(false);
    expect(isIgnored('interview_request')).toBe(false);
    expect(isIgnored('offer')).toBe(false);
    expect(isIgnored('application_acknowledged')).toBe(false);
    expect(isIgnored('follow_up_needed')).toBe(false);
  });

  it('no longer ignores recruiter_outreach — it routes to "Action needed"', () => {
    expect(isIgnored('recruiter_outreach')).toBe(false);
  });
});

// ---------- confidence-gating logic ----------

function shouldAutoApply(
  classification: string,
  confidence: number,
  applicationId: string | null,
  suggestedStatus: string | null,
): boolean {
  return (
    confidence >= 0.8 &&
    applicationId !== null &&
    suggestedStatus !== null &&
    ['rejection', 'interview_request', 'offer'].includes(classification)
  );
}

describe('shouldAutoApply', () => {
  it('auto-applies a high-confidence rejection with a matched application', () => {
    expect(shouldAutoApply('rejection', 0.95, 'app-123', 'rejected')).toBe(true);
  });

  it('does not auto-apply when confidence is below threshold', () => {
    expect(shouldAutoApply('rejection', 0.79, 'app-123', 'rejected')).toBe(false);
  });

  it('does not auto-apply when there is no matched application', () => {
    expect(shouldAutoApply('rejection', 0.95, null, 'rejected')).toBe(false);
  });

  it('does not auto-apply for recruiter_outreach even at high confidence', () => {
    expect(shouldAutoApply('recruiter_outreach', 0.99, 'app-123', null)).toBe(false);
  });

  it('does not auto-apply when suggestedStatus is null', () => {
    expect(shouldAutoApply('rejection', 0.95, 'app-123', null)).toBe(false);
  });
});

// ---------- processRecord end-to-end routing (real DDB + stubbed LLM) ----------
//
// These run the actual SQS-record handler against DynamoDB Local. The LLM is driven
// by stubbing global fetch: with no Gemini/Claude keys configured in the test env,
// callLLM() falls through to the Ollama HTTP path, so a stubbed fetch lets us return
// any classification verbatim. This locks in the reported bug at the full-flow level:
// a recruiter outreach (or an application-process survey) must NEVER create a phantom
// "applied" application — even when the model returns high confidence and new-app data.

async function clearTable() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  await Promise.all(
    (result.Items ?? []).map(item =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
}

// Make callLLM() return `result` by shaping it as an Ollama chat completion.
function stubLLM(result: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    }),
  );
}

async function getApplications(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'APP#' },
  }));
  return result.Items ?? [];
}

async function getEmail(userId: string, msgId: string) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.email(userId, msgId) }));
  return result.Item;
}

describe('processRecord — routing (end-to-end)', () => {
  const USER = 'user-classifier-e2e';

  beforeEach(clearTable);
  afterEach(() => vi.unstubAllGlobals());

  function makeMsg(overrides: Record<string, unknown> = {}) {
    return {
      userId: USER,
      gmailMsgId: `msg-${crypto.randomUUID()}`,
      sender: 'recruiter@acme-staffing.com',
      subject: 'Exciting Backend Engineer opportunity',
      snippet: 'I came across your profile and we have an opening that might interest you.',
      body: 'I came across your profile and we have an opening that might interest you.',
      receivedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('routes recruiter outreach to Action needed without creating an application', async () => {
    // High confidence AND populated new-application data: even so, recruiter_outreach
    // must not auto-create. This is the exact bug — a recruiter reach-out becoming a
    // phantom "applied" application.
    stubLLM({
      classification: 'recruiter_outreach',
      confidence: 0.95,
      applicationId: null,
      suggestedStatus: null,
      newApplication: { company: 'Acme', role: 'Backend Engineer', jobUrl: null, notes: null },
      actionSummary: 'Reply to recruiter about Backend role',
      actionDeadline: null,
    });

    const msg = makeMsg();
    await processRecord(msg);

    // No application created.
    expect(await getApplications(USER)).toHaveLength(0);

    // Email surfaces as an action item in the review queue.
    const email = await getEmail(USER, msg.gmailMsgId);
    expect(email?.classification).toBe('recruiter_outreach');
    expect(email?.needsReview).toBe(true);
    expect(email?.status).toBe('classified');
    expect(email?.suggestedStatus).toBeNull();
    expect(email?.actionSummary).toBe('Reply to recruiter about Backend role');
  });

  it('ignores an application-process feedback survey without creating an application', async () => {
    // Survey / "rate your candidate experience" email. Even with high confidence and
    // new-app data, it must be tombstoned (ignored), not auto-created.
    stubLLM({
      classification: 'application_feedback',
      confidence: 0.95,
      applicationId: null,
      suggestedStatus: null,
      newApplication: { company: 'Acme', role: 'Backend Engineer', jobUrl: null, notes: null },
      actionSummary: null,
      actionDeadline: null,
    });

    const msg = makeMsg({
      subject: 'How was your application experience?',
      snippet: 'Help us improve our hiring process — take this 2-minute survey.',
      body: 'Help us improve our hiring process — take this 2-minute survey.',
    });
    await processRecord(msg);

    // No application created.
    expect(await getApplications(USER)).toHaveLength(0);

    // Email is tombstoned as ignored, not surfaced for review.
    const email = await getEmail(USER, msg.gmailMsgId);
    expect(email?.classification).toBe('application_feedback');
    expect(email?.status).toBe('ignored');
    expect(email?.needsReview).toBeUndefined();
  });
});
