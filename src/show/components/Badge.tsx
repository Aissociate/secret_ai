interface BadgeProps {
  text: string;
  variant?: 'default' | 'live' | 'eliminated' | 'accent';
}

const variants: Record<string, string> = {
  default:
    'bg-white/5 border-white/10 text-white/90',
  live: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
  eliminated: 'bg-red-500/15 border-red-400/30 text-red-300',
  accent: 'bg-amber-500/15 border-amber-400/30 text-amber-300',
};

export function Badge({ text, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={`inline-block text-xs px-2.5 py-1 rounded-full border font-medium tracking-wide ${variants[variant]}`}
    >
      {text}
    </span>
  );
}
