import { Clock3, Loader2, LogOut, Users } from 'lucide-react';
import OnlineUsersList from '@/components/OnlineUsersList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePortal } from '@/context/PortalContext';

export default function QueuePage() {
  const { username, queuePosition, onlineCount, maxOnlineUsers, onlineUsers, systemStatus, sessionPhase, changeUser } =
    usePortal();
  const loggingOut = sessionPhase === 'loggingOut';

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr),minmax(300px,0.8fr)]">
        <Card className="shadow-glow gradient-border">
          <CardHeader>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Clock3 className="text-primary" />
            </div>
            <CardTitle>You’re in the admission queue</CardTitle>
            <CardDescription>
              The portal is currently at capacity. Keep this tab open; your place is preserved while the system stream remains
              connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Queue position</p>
                <p className="mt-1 text-3xl font-semibold text-primary">{queuePosition ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Portal capacity</p>
                <p className="mt-1 text-3xl font-semibold">
                  {onlineCount} / {maxOnlineUsers || '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <span
                className={`h-2 w-2 rounded-full ${systemStatus === 'connected' ? 'bg-green-500' : 'animate-pulse bg-amber-400'}`}
              />
              Signed in as {username} · System stream {systemStatus}
            </div>
            <Button type="button" variant="outline" className="gap-2" disabled={loggingOut} onClick={() => void changeUser()}>
              {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Leave queue
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Currently online
            </CardTitle>
            <CardDescription>Activity updates arrive from the portal in real time.</CardDescription>
          </CardHeader>
          <CardContent>
            <OnlineUsersList users={onlineUsers} currentUsername={username} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
