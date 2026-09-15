import { useState } from 'react';
import { Loader2, Server, ShieldCheck, EyeIcon, EyeOffIcon } from 'lucide-react';
import { usePortal } from '@/context/PortalContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function UsernameGate() {
  const { acceptUser, validationState, validationError } = usePortal();
  const [value, setValue] = useState('');
  const [passValue, setPassValue] = useState('default');
  const [isEyeOpen, setIsEyeOpen] = useState(false);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    acceptUser(value, passValue);
  };
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-background">
      <Card className="w-full max-w-md shadow-glow gradient-border">
        <CardHeader className="text-center items-center">
          <div className="w-12 h-12 rounded-xl grid place-items-center bg-primary/10 border border-primary/30 mb-2">
            <Server className="text-primary" />
          </div>
          <CardTitle>QC Deployment Orchestrator</CardTitle>
          <CardDescription>Enter your configured username to open the portal.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Input
                id="portal-username"
                autoFocus
                autoComplete="username"
                placeholder='Username'
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-2"
              />
              <div className="relative">
                <Input
                  id="portal-password"
                  autoFocus
                  autoComplete="password"
                  type={`${isEyeOpen ? "text" : "password"}`}
                  value={passValue}
                  placeholder='Password (use default)'
                  onChange={(e) => setPassValue(e.target.value)}
                  className="mt-2 mr-6"
                />
                <div 
                  className="absolute z-10 right-3 inset-y-2.5 " 
                  onClick={() => setIsEyeOpen(prev => !prev)}
                >
                {
                  isEyeOpen ?
                  <EyeOffIcon className="w-5 h-5 "/> : <EyeIcon className="w-5 h-5"/>
                }
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Spaces, underscores, hyphens, and letter case are ignored when matching.
              </p>
              {validationError && (
                <p className="text-sm text-red-700 mt-2" role="alert">
                  {validationError}
                </p>
              )}
            </div>
            <Button className="w-full gap-2" disabled={validationState === 'validating'}>
              {validationState === 'validating' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              {validationState === 'validating' ? 'Validating…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
