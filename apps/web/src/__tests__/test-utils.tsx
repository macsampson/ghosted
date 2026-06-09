import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Application, EmailEvent, ResumeVersion } from '@/types';

// A QueryClient with retries off and caching disabled so tests are deterministic
// and don't leak state between cases.
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  client?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, opts: ProvidersOptions = {}) {
  const { route = '/', client = createTestQueryClient(), ...rest } = opts;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper, ...rest }) };
}

// react-query wrapper for renderHook (no router).
export function queryWrapper(client = createTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ---------- domain factories ----------

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

export function makeApp(overrides: Partial<Application> = {}): Application {
  const now = new Date().toISOString();
  return {
    appId: uid('app'),
    company: 'Acme',
    role: 'Engineer',
    status: 'applied',
    appliedAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

export function makeResume(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    versionId: uid('resume'),
    label: 'SWE v1',
    s3Key: 'resumes/x.pdf',
    uploadedAt: new Date().toISOString(),
    useCount: 0,
    ...overrides,
  };
}

export function makeEmail(overrides: Partial<EmailEvent> = {}): EmailEvent {
  const id = uid('email');
  return {
    emailId: id,
    gmailMsgId: id,
    sender: 'recruiter@corp.com',
    subject: 'Re: your application',
    snippet: 'Thanks for applying',
    receivedAt: new Date().toISOString(),
    classification: 'interview_request',
    confidence: 0.55,
    needsReview: true,
    reviewed: false,
    ...overrides,
  };
}
