import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const getUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/" element={<div>landing page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProtectedRoute', () => {
  it('shows a loading spinner before auth resolves', () => {
    getUser.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderGuard();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders the nested route when authenticated', async () => {
    getUser.mockResolvedValue({ sub: 'u1' });
    renderGuard();
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('redirects to / when not authenticated', async () => {
    getUser.mockRejectedValue(new Error('nope'));
    renderGuard();
    expect(await screen.findByText('landing page')).toBeInTheDocument();
  });
});
