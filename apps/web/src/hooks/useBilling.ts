import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Starts Stripe Checkout for the Pro subscription and redirects the browser to
 * the hosted checkout page. The user must already be signed in (the API needs a
 * user to attach the subscription to).
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: () => api.post<{ url: string }>('/billing/checkout', {}),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
  });
}

/** Opens the Stripe Billing Portal so a Pro user can manage or cancel. */
export function useOpenPortal() {
  return useMutation({
    mutationFn: () => api.post<{ url: string }>('/billing/portal', {}),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
  });
}
