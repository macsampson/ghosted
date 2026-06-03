import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function Dashboard() {
  const { data } = useQuery({
    queryKey: ['hello'],
    queryFn: () => api.get<{ message: string; sub: string; email: string }>('/hello'),
  });

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      {data && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-green-600">Auth working ✓</p>
          <p className="mt-1 text-muted-foreground">Signed in as {data.email}</p>
        </div>
      )}

      <p className="mt-8 text-muted-foreground">Applications and analytics coming in Days 4–9.</p>
    </div>
  );
}
