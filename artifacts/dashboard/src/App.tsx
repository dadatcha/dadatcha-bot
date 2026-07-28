import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/layout/sidebar';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import Overview from '@/pages/overview';
import Economy from '@/pages/economy';
import Shop from '@/pages/shop';
import RoleRewards from '@/pages/role-rewards';
import Commands from '@/pages/commands';
import Games from '@/pages/games';
import Reminder from '@/pages/reminder';
import Giveaway from '@/pages/giveaway';
import RandomActivity from '@/pages/random-activity';
import Logs from '@/pages/logs';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function Router() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/economy" component={Economy} />
          <Route path="/shop" component={Shop} />
          <Route path="/roles" component={RoleRewards} />
          <Route path="/commands" component={Commands} />
          <Route path="/games" component={Games} />
          <Route path="/reminder" component={Reminder} />
          <Route path="/giveaway" component={Giveaway} />
          <Route path="/random-activity" component={RandomActivity} />
          <Route path="/logs" component={Logs} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
