import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { router } from './router';
import { queryClient } from './lib/queryClient';

// Amplify fires Hub events when the OAuth callback completes.
// Navigating here ensures the app reflects the newly authenticated state.
Hub.listen('auth', ({ payload }) => {
  if (payload.event === 'signedIn') {
    router.navigate('/dashboard', { replace: true });
  }
  if (payload.event === 'signedOut') {
    router.navigate('/login', { replace: true });
  }
});

export default function App() {
  useEffect(() => {
    getCurrentUser()
      .then(() => {
        const path = window.location.pathname;
        if (path === '/' || path === '/login') {
          router.navigate('/dashboard', { replace: true });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
