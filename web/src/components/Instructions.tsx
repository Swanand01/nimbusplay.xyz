import { Panel } from './Panel';

const RELEASE_URL = 'https://github.com/Swanand01/moonlight-android/releases/latest';

export function Instructions() {
  return (
    <Panel title="How to play">
      <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-sm text-gray-200">
        <li>
          Install the Artemis app once:{' '}
          <a className="text-neon underline" href={RELEASE_URL} target="_blank" rel="noreferrer">
            download the APK
          </a>
          , open it, and allow installs from your browser when asked.
        </li>
        <li>Press Start gaming and wait until it says Ready. The first start takes a few minutes.</li>
        <li>Press Connect. Artemis opens and pairs with your PC by itself.</li>
        <li>Press Stop when you&rsquo;re finished, so your PC isn&rsquo;t left running.</li>
      </ol>
    </Panel>
  );
}
