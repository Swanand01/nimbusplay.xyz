import type { ReactNode } from 'react';

const VARIANTS = {
  primary: 'bg-neon text-void hover:brightness-110',
  danger: 'bg-transparent text-magenta border border-magenta/60',
  ghost: 'bg-transparent text-neon min-h-10 text-xs tracking-normal'
} as const;

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button'
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof VARIANTS;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-display font-bold text-sm uppercase tracking-wider w-full min-h-12 px-4 py-3 rounded-2xl transition active:scale-[0.99] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon ${VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}
