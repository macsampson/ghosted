import { describe, it, expect } from 'vitest';
import {
  sortApplications,
  defaultSort,
  nextSort,
  type SortState,
} from '@/lib/applicationSort';
import type { Application } from '@/types';
import { makeApp } from './test-utils';

function ids(apps: Application[]): string[] {
  return apps.map(a => a.appId);
}

describe('defaultSort', () => {
  it('orders by lastActivityAt descending', () => {
    const older = makeApp({ appId: 'a', lastActivityAt: '2026-01-01T00:00:00Z' });
    const newer = makeApp({ appId: 'b', lastActivityAt: '2026-06-01T00:00:00Z' });
    expect(ids(defaultSort([older, newer]))).toEqual(['b', 'a']);
  });

  it('breaks same-activity ties by createdAt descending, then appId', () => {
    const day = '2026-03-03T12:00:00Z';
    const a = makeApp({ appId: 'a', lastActivityAt: day, appliedAt: day, createdAt: '2026-03-03T01:00:00Z' });
    const b = makeApp({ appId: 'b', lastActivityAt: day, appliedAt: day, createdAt: '2026-03-03T09:00:00Z' });
    expect(ids(defaultSort([a, b]))).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [makeApp({ appId: 'a' }), makeApp({ appId: 'b' })];
    const copy = [...input];
    defaultSort(input);
    expect(input).toEqual(copy);
  });
});

describe('sortApplications', () => {
  it('falls back to defaultSort when no column is selected', () => {
    const a = makeApp({ appId: 'a', lastActivityAt: '2026-01-01T00:00:00Z' });
    const b = makeApp({ appId: 'b', lastActivityAt: '2026-06-01T00:00:00Z' });
    expect(ids(sortApplications([a, b], null))).toEqual(['b', 'a']);
  });

  it('sorts company ascending and descending, case-insensitively', () => {
    const apps = [
      makeApp({ appId: 'z', company: 'Zebra' }),
      makeApp({ appId: 'a', company: 'apple' }),
      makeApp({ appId: 'm', company: 'Mango' }),
    ];
    expect(ids(sortApplications(apps, { key: 'company', dir: 'asc' }))).toEqual(['a', 'm', 'z']);
    expect(ids(sortApplications(apps, { key: 'company', dir: 'desc' }))).toEqual(['z', 'm', 'a']);
  });

  it('sorts by role and by lastActivityAt', () => {
    const apps = [
      makeApp({ appId: 'b', role: 'Backend', lastActivityAt: '2026-01-01T00:00:00Z' }),
      makeApp({ appId: 'a', role: 'Analyst', lastActivityAt: '2026-06-01T00:00:00Z' }),
    ];
    expect(ids(sortApplications(apps, { key: 'role', dir: 'asc' }))).toEqual(['a', 'b']);
    expect(ids(sortApplications(apps, { key: 'lastActivityAt', dir: 'asc' }))).toEqual(['b', 'a']);
  });

  it('sinks rows with no applied date to the bottom', () => {
    const dated = makeApp({ appId: 'dated', appliedAt: '2026-05-05T00:00:00Z' });
    const undated = makeApp({ appId: 'undated', appliedAt: '' });
    expect(ids(sortApplications([undated, dated], { key: 'appliedAt', dir: 'asc' }))).toEqual(['dated', 'undated']);
  });

  it('sorts status by pipeline order, not alphabetically', () => {
    const apps = [
      makeApp({ appId: 'onsite', status: 'onsite' }),
      makeApp({ appId: 'applied', status: 'applied' }),
      makeApp({ appId: 'oa', status: 'online_assessment' }),
    ];
    // applied < online_assessment < onsite by pipeline order (alpha would put oa first).
    expect(ids(sortApplications(apps, { key: 'status', dir: 'asc' }))).toEqual(['applied', 'oa', 'onsite']);
  });

  it('sorts salary by range min', () => {
    const apps = [
      makeApp({ appId: 'hi', salaryRange: { min: 180000, max: 220000, currency: 'USD' } }),
      makeApp({ appId: 'lo', salaryRange: { min: 90000, max: 110000, currency: 'USD' } }),
    ];
    expect(ids(sortApplications(apps, { key: 'salary', dir: 'asc' }))).toEqual(['lo', 'hi']);
  });

  it('sinks rows with no salary to the bottom in both directions', () => {
    const withSalary = makeApp({ appId: 'has', salaryRange: { min: 100000, max: 120000, currency: 'USD' } });
    const none = makeApp({ appId: 'none' });
    expect(ids(sortApplications([none, withSalary], { key: 'salary', dir: 'asc' }))).toEqual(['has', 'none']);
    expect(ids(sortApplications([none, withSalary], { key: 'salary', dir: 'desc' }))).toEqual(['has', 'none']);
  });

  it('breaks equal-value ties deterministically via defaultCompare', () => {
    const a = makeApp({ appId: 'a', company: 'Acme', lastActivityAt: '2026-01-01T00:00:00Z' });
    const b = makeApp({ appId: 'b', company: 'Acme', lastActivityAt: '2026-06-01T00:00:00Z' });
    // Same company → tie broken by lastActivityAt desc (b before a) regardless of asc/desc.
    expect(ids(sortApplications([a, b], { key: 'company', dir: 'asc' }))).toEqual(['b', 'a']);
    expect(ids(sortApplications([a, b], { key: 'company', dir: 'desc' }))).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [makeApp({ appId: 'a', company: 'B' }), makeApp({ appId: 'b', company: 'A' })];
    const copy = [...input];
    sortApplications(input, { key: 'company', dir: 'asc' });
    expect(input).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('starts a fresh column ascending', () => {
    expect(nextSort(null, 'company')).toEqual({ key: 'company', dir: 'asc' });
  });

  it('flips direction when the same column is clicked again', () => {
    const asc: SortState = { key: 'company', dir: 'asc' };
    expect(nextSort(asc, 'company')).toEqual({ key: 'company', dir: 'desc' });
    expect(nextSort({ key: 'company', dir: 'desc' }, 'company')).toEqual({ key: 'company', dir: 'asc' });
  });

  it('resets to ascending when switching columns', () => {
    expect(nextSort({ key: 'company', dir: 'desc' }, 'role')).toEqual({ key: 'role', dir: 'asc' });
  });
});
