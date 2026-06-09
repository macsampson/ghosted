import { describe, it, expect } from 'vitest';
import { router } from '@/router';

describe('router', () => {
  it('builds the route tree with a public /login and a guarded shell', () => {
    const paths = router.routes.map(r => r.path);
    expect(paths).toContain('/login');
    expect(paths).toContain('/');

    // The guarded root nests the layout, which nests the feature pages.
    const root = router.routes.find(r => r.path === '/')!;
    const layout = root.children?.[0];
    const childPaths = layout?.children?.map(c => c.path ?? (c.index ? 'index' : undefined)) ?? [];
    expect(childPaths).toEqual(
      expect.arrayContaining(['index', 'dashboard', 'applications', 'resumes', 'pipeline', 'analytics', 'email-review', 'settings']),
    );
  });
});
