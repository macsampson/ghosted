import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout } from '@/lib/auth';
import { Ghost, LayoutDashboard, List, Columns, BarChart2, LogOut, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/applications', label: 'Applications', Icon: List },
  { to: '/resumes', label: 'Resumes', Icon: FileText },
  { to: '/pipeline', label: 'Pipeline', Icon: Columns },
  { to: '/analytics', label: 'Analytics', Icon: BarChart2 },
];

export function AppLayout() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-card px-3 py-4">
        <Link to="/dashboard" className="mb-6 flex items-center gap-2 px-2">
          <Ghost className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold tracking-tight">ghosted</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
