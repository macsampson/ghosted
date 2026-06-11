import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Applications } from './pages/Applications';
import { Resumes } from './pages/Resumes';
import { Pipeline } from './pages/Pipeline';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { EmailReview } from './pages/EmailReview';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Landing />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: 'dashboard', element: <Dashboard /> },
          // Days 4-9: fill in Applications, Pipeline, Analytics
          { path: 'applications', element: <Applications /> },
          { path: 'resumes', element: <Resumes /> },
          { path: 'pipeline', element: <Pipeline /> },
          { path: 'analytics', element: <Analytics /> },
          { path: 'email-review', element: <EmailReview /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
]);
