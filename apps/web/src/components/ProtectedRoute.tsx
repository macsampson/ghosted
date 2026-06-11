import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getUser } from '@/lib/auth';

export function ProtectedRoute() {
  const [state, setState] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  useEffect(() => {
    getUser()
      .then(() => setState('authed'))
      .catch(() => setState('unauthed'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === 'unauthed') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
