import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const getUser = vi.fn();
const startGoogleSignIn = vi.fn();
vi.mock('@/lib/auth', () => ({
  getUser: () => getUser(),
  startGoogleSignIn: (...a: unknown[]) => startGoogleSignIn(...a),
}));

async function renderLanding(initial = '/') {
  const { Landing } = await import('@/pages/Landing');
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Landing', () => {
  it('shows the marketing content when not signed in', async () => {
    getUser.mockRejectedValue(new Error('no session'));
    await renderLanding();

    expect(
      await screen.findByRole('heading', { name: /companies ghost/i }),
    ).toBeInTheDocument();
    // a sampling of content from across the section components
    expect(screen.getByText(/job searching at scale gets messy fast/i)).toBeInTheDocument();
    expect(screen.getByText(/AI inbox monitoring/i)).toBeInTheDocument();
    expect(screen.getByText(/set it up once\. it works in the background/i)).toBeInTheDocument();
    expect(screen.getByText(/inbox access you can actually trust/i)).toBeInTheDocument();
    expect(screen.getByText(/read the technical write-up/i)).toBeInTheDocument();
  });

  it('starts Google sign-in when a CTA is clicked', async () => {
    getUser.mockRejectedValue(new Error('no session'));
    await renderLanding();

    const ctas = await screen.findAllByRole('button', { name: /get started with google/i });
    await userEvent.click(ctas[0]);
    expect(startGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it('redirects to the dashboard when already signed in', async () => {
    getUser.mockResolvedValue({ sub: 'u1' });
    await renderLanding();
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
  });
});
