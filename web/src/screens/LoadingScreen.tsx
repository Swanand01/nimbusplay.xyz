import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { StatusLine } from '../components/StatusLine';

export function LoadingScreen({
  error,
  onRetry,
  onSignOut
}: {
  error: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <Panel>
        <StatusLine text={error ? 'Offline' : 'Checking…'} tone={error ? 'amber' : 'neon'} />
        {error && <p className="text-sm text-gray-300">{error}</p>}
        {error && <Button onClick={onRetry}>Retry</Button>}
      </Panel>
      <Button variant="ghost" onClick={onSignOut}>
        Log out
      </Button>
    </>
  );
}
