import { Panel } from './Panel';

const RELEASE_URL = 'https://github.com/Swanand01/moonlight-android/releases/latest';

export function Instructions() {
  return (
    <Panel title="Before you start">
      <p className="text-sm text-gray-200">
        Streaming needs the Artemis app on your Android phone.{' '}
        <a className="text-neon underline" href={RELEASE_URL} target="_blank" rel="noreferrer">
          Install Artemis
        </a>
      </p>
    </Panel>
  );
}
