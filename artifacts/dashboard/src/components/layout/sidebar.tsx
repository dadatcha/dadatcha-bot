import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Coins, Gamepad2, Bell, ScrollText, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGetBotStatus } from '@workspace/api-client-react';

type NavItem = {
  path: string;
  label: string;
  icon: React.ElementType;
};

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: 'General',
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard },
      { path: '/logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Modules',
    items: [
      { path: '/economy', label: 'Economy', icon: Coins },
      { path: '/games', label: 'Games', icon: Gamepad2 },
      { path: '/reminder', label: 'Reminder', icon: Bell },
    ],
  },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: status } = useGetBotStatus({
    query: { refetchInterval: 10000 },
  });
  const online = status?.connected ?? false;

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: 'hsl(var(--sidebar))', borderRight: '1px solid hsl(var(--sidebar-border))' }}>

      {/* Bot identity */}
      <div className="px-5 py-5 border-b" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            DB
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>
              dadatcha_bot
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Circle
                className={cn('w-2 h-2 fill-current', online ? 'text-green-400' : 'text-zinc-500')}
              />
              <span className="text-xs" style={{ color: 'hsl(var(--sidebar-foreground))' }}>
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'hsl(var(--sidebar-foreground) / 0.45)' }}>
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'text-white'
                        : 'hover:text-white'
                    )}
                    style={
                      isActive
                        ? { background: 'hsl(var(--sidebar-primary))', color: 'white' }
                        : { color: 'hsl(var(--sidebar-foreground))' }
                    }
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-5 py-3 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <span className="text-[11px]" style={{ color: 'hsl(var(--sidebar-foreground) / 0.4)' }}>
          LottoDash v2.0
        </span>
      </div>
    </aside>
  );
}
