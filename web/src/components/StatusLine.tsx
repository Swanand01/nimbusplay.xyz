const TONES = { neon: 'text-neon', amber: 'text-amber', magenta: 'text-magenta' } as const;

export function StatusLine({ text, tone = 'neon' }: { text: string; tone?: keyof typeof TONES }) {
  return (
    <p className={`font-display text-base font-semibold uppercase tracking-[0.14em] ${TONES[tone]}`} role="status">
      {text}
    </p>
  );
}
