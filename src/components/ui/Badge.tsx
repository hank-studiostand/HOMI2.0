import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

export default function Badge({ children, variant = 'default', className }: BadgeProps) {
  // Use CSS variables so it works with both light and dark themes
  const styles: Record<BadgeVariant, React.CSSProperties> = {
    default: { background: 'var(--surface-3)', color: 'var(--text-secondary)' },
    accent:  { background: 'var(--accent-subtle)', color: 'var(--accent)' },
    success: { background: 'var(--success-bg)', color: 'var(--success)' },
    warning: { background: 'var(--warning-bg)', color: 'var(--warning)' },
    danger:  { background: 'var(--danger-bg)',  color: 'var(--danger)' },
    muted:   { background: 'var(--surface-2)',  color: 'var(--text-muted)' },
  }

  return (
    <span
      className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium', className)}
      style={styles[variant]}
    >
      {children}
    </span>
  )
}
