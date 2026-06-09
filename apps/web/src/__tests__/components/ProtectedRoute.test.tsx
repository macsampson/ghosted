import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const getUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>protected content</div>} />
        </Route>
        <Route path="/login" element={<div>login page</div>} />
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

  it('redirects to /login when not authenticated', async () => {
    getUser.mockRejectedValue(new Error('nope'));
    renderGuard();
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});
