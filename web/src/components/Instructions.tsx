import { Panel } from './Panel';

const RELEASE_URL = 'https://github.com/Swanand01/moonlight-android/releases/latest';

export function Instructions() {
  return (
    <Panel title="How to play">
      <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-sm text-gray-200">
        <li>
          First time here?{' '}
          <a className="text-neon underline" href={RELEASE_URL} target="_blank" rel="noreferrer">
            Install the Artemis app
          </a>{' '}
          on your phone.
        </li>
        <li>Press Start gaming, then Connect when your PC is ready.</li>
        <li>Press Stop when you&rsquo;re finished, so your PC isn&rsquo;t left running.</li>
      </ol>
    </Panel>
  );
}
