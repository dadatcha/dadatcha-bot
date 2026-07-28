import { Link, useLocation } from 'wouter';
import { Activity, Terminal, Settings, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Activity },
    { path: '/commands', label: 'Commands', icon: Terminal },
    { path: '/config', label: 'Config', icon: Settings },
    { path: '/logs', label: 'Logs', icon: ScrollText },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-foreground font-mono tracking-tight">
          LottoDash
        </h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1 font-mono">
          dadatcha_bot control
        </p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;
          
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs font-mono text-sidebar-foreground/50">
          v1.0.0
        </div>
      </div>
    </aside>
  );
}
