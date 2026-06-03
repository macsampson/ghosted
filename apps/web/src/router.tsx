import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Applications } from './pages/Applications';
import { Resumes } from './pages/Resumes';
import { Pipeline } from './pages/Pipeline';
import { Settings } from './pages/Settings';
import { EmailReview } from './pages/EmailReview';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <Dashboard /> },
          // Days 4-9: fill in Applications, Pipeline, Analytics
          { path: 'applications', element: <Applications /> },
          { path: 'resumes', element: <Resumes /> },
          { path: 'pipeline', element: <Pipeline /> },
          { path: 'analytics', element: <div className="p-8">Analytics — coming soon</div> },
          { path: 'email-review', element: <EmailReview /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
]);
