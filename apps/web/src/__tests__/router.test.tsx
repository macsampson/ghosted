import { describe, it, expect } from 'vitest';
import { router } from '@/router';

describe('router', () => {
  it('serves a public landing page at / and a guarded shell for the app', () => {
    const paths = router.routes.map(r => r.path);
    // Public routes.
    expect(paths).toContain('/');

    // '/' is the public landing page — no nested app routes hang off it.
    const landing = router.routes.find(r => r.path === '/')!;
    expect(landing.children).toBeUndefined();

    // The guarded shell is a pathless layout route that nests AppLayout, which
    // nests the feature pages.
    const guarded = router.routes.find(r => r.path === undefined && r.children)!;
    const layout = guarded.children?.[0];
    const childPaths = layout?.children?.map(c => c.path) ?? [];
    expect(childPaths).toEqual(
      expect.arrayContaining(['dashboard', 'applications', 'resumes', 'pipeline', 'analytics', 'email-review', 'settings']),
    );
    // The old index → /dashboard redirect is gone now that / is the landing page.
    expect(childPaths).not.toContain(undefined);
  });
});
