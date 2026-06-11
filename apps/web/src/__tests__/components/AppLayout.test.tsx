import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';

const logout = vi.fn();
vi.mock('@/lib/auth', () => ({ logout: () => logout() }));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<div>dashboard body</div>} />
        </Route>
        <Route path="/" element={<div>landing page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AppLayout', () => {
  it('renders all nav links and the outlet content', () => {
    renderLayout();
    for (const label of ['Dashboard', 'Applications', 'Resumes', 'Pipeline', 'Analytics', 'Email review', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('dashboard body')).toBeInTheDocument();
  });

  it('signs out and navigates to /', async () => {
    logout.mockResolvedValue(undefined);
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByText('landing page')).toBeInTheDocument();
  });

  it('opens the mobile drawer and closes it via the backdrop', async () => {
    const { container } = renderLayout();
    const backdrop = () => container.querySelector('.bg-black\\/40');

    // Backdrop only renders while the drawer is open.
    expect(backdrop()).toBeNull();
    await userEvent.click(screen.getByLabelText('Open menu'));
    expect(backdrop()).not.toBeNull();

    await userEvent.click(backdrop()!);
    await waitFor(() => expect(backdrop()).toBeNull());
  });
});
