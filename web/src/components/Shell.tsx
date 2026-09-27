import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-8">
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5">
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neon">
            NIMBUS<span className="text-magenta"> PLAY</span>
          </h1>
          <p className="text-sm text-gray-400">Your gaming PC, in the cloud.</p>
        </header>
        {children}
      </div>
    </main>
  );
}
