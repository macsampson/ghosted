import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeNotice } from '@/components/UpgradeNotice';
import { renderWithProviders } from '../test-utils';

describe('UpgradeNotice', () => {
  it('renders the message and a link to the pricing page', () => {
    renderWithProviders(<UpgradeNotice message="You hit the limit." />);
    expect(screen.getByText('You hit the limit.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view plans/i })).toHaveAttribute('href', '/pricing');
  });

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    renderWithProviders(<UpgradeNotice message="Limit." onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
