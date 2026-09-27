import { Shell } from './components/Shell';
import { StatusLine } from './components/StatusLine';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { OfflineScreen } from './screens/OfflineScreen';
import { useNimbus } from './state/useNimbus';

export function App() {
  const nimbus = useNimbus();

  if (nimbus.auth === 'unknown') {
    return (
      <Shell>
        <StatusLine text="Loading" />
      </Shell>
    );
  }

  if (nimbus.auth === 'unreachable') {
    return (
      <Shell>
        <OfflineScreen message={nimbus.error ?? "Couldn't reach the server"} onRetry={() => void nimbus.retrySignIn()} />
      </Shell>
    );
  }

  if (nimbus.auth === 'signed-out') {
    return (
      <Shell>
        {nimbus.notice && <p className="text-sm text-amber">{nimbus.notice}</p>}
        <AuthScreen onSignedIn={nimbus.signIn} />
      </Shell>
    );
  }

  if (!nimbus.sessionKnown) {
    return (
      <Shell>
        <LoadingScreen
          error={nimbus.error}
          onRetry={() => void nimbus.retrySession()}
          onSignOut={() => void nimbus.signOut()}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <HomeScreen
        session={nimbus.session}
        error={nimbus.error}
        onStart={() => void nimbus.start()}
        onStop={() => void nimbus.stop()}
        onSignOut={() => void nimbus.signOut()}
      />
    </Shell>
  );
}
