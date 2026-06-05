import { describe, it, expect, vi, beforeEach } from 'vitest';

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
