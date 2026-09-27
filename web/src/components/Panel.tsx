import type { ReactNode } from 'react';

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="bg-panel rounded-3xl border border-white/5 p-5 flex flex-col gap-4">
      {title && (
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-neon">{title}</h2>
      )}
      {children}
    </section>
  );
}
