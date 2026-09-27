import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { StatusLine } from '../components/StatusLine';

export function OfflineScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <StatusLine text="Offline" tone="amber" />
      <p className="text-sm text-gray-300">{message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </Panel>
  );
}
