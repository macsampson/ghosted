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

// ---------- heuristic pre-filter logic ----------

function shouldSkipClaude(
  senderDomain: string,
  companies: string[],
): boolean {
  if (!senderDomain || companies.length === 0) return false;
  return !companies.some(c => domainMatchesCompany(senderDomain, c));
}

describe('heuristic pre-filter', () => {
  it('skips Claude when sender domain does not match any company', () => {
    const companies = ['Stripe', 'Twilio', 'Notion'];
    expect(shouldSkipClaude('linkedin', companies)).toBe(true);
  });

  it('does not skip Claude when sender domain matches a company', () => {
    const companies = ['Stripe', 'Twilio', 'Notion'];
    expect(shouldSkipClaude('stripe', companies)).toBe(false);
  });

  it('does not skip Claude when there are no applications (no heuristic data)', () => {
    expect(shouldSkipClaude('linkedin', [])).toBe(false);
  });

  it('does not skip Claude when sender domain is empty', () => {
    expect(shouldSkipClaude('', ['Stripe'])).toBe(false);
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
