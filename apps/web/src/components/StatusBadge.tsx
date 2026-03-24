type StatusBadgeProps = {
  tone:
    | "confirmed"
    | "provisional"
    | "visibility"
    | "trace"
    | "yes"
    | "no"
    | "abstain"
    | "absent"
    | "invalid"
    | "unknown";
  children: string;
};

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
