import { describe, it, expect } from 'vitest';
import { searchApplications } from '@/lib/applicationSearch';
import { makeApp } from './test-utils';

const apps = [
  makeApp({ appId: 'stripe', company: 'Stripe', role: 'Backend Engineer', notes: 'Referred by Dana' }),
  makeApp({ appId: 'datadog', company: 'Datadog', role: 'Frontend Engineer', notes: undefined }),
  makeApp({ appId: 'acme', company: 'Acme', role: 'Platform Engineer', notes: 'Cold applied' }),
];

describe('searchApplications', () => {
  it('returns the list unchanged for an empty or whitespace query', () => {
    expect(searchApplications(apps, '')).toBe(apps);
    expect(searchApplications(apps, '   ')).toBe(apps);
  });

  it('matches company case-insensitively', () => {
    expect(searchApplications(apps, 'stripe').map(a => a.appId)).toEqual(['stripe']);
    expect(searchApplications(apps, 'DATADOG').map(a => a.appId)).toEqual(['datadog']);
  });

  it('matches role substrings', () => {
    expect(searchApplications(apps, 'frontend').map(a => a.appId)).toEqual(['datadog']);
  });

  it('matches notes', () => {
    expect(searchApplications(apps, 'dana').map(a => a.appId)).toEqual(['stripe']);
  });

  it('tolerates applications with no notes', () => {
    expect(searchApplications(apps, 'engineer').map(a => a.appId)).toEqual(['stripe', 'datadog', 'acme']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchApplications(apps, 'nvidia')).toEqual([]);
  });

  it('trims surrounding whitespace from the query', () => {
    expect(searchApplications(apps, '  stripe  ').map(a => a.appId)).toEqual(['stripe']);
  });
});
