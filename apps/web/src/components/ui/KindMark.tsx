import { kindIcon, kindTint } from '../../lib/kindIcons.ts';

/** The tinted icon chip that stands for a kind, on rows and headers. */
export function KindMark({ kind, size = 'sm', icon }: { kind: string; size?: 'sm' | 'lg'; icon?: React.ComponentType<{ size?: number; strokeWidth?: number }> | undefined }) {
  const Icon = icon ?? kindIcon(kind);
  return (
    <span className={`icon-chip ${size === 'lg' ? 'icon-chip-lg' : ''}`} style={{ ['--chip-tint' as string]: kindTint(kind) }} aria-hidden data-testid="kind-mark">
      <Icon size={size === 'lg' ? 20 : 14} strokeWidth={1.9} />
    </span>
  );
}
