import Link from "next/link";

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: "var(--accent)" }}
      />
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const style: Record<string, { bg: string; fg: string }> = {
    open: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    active: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    draft: { bg: "var(--warn-soft)", fg: "var(--warn)" },
    closed: { bg: "var(--border)", fg: "var(--ink-soft)" },
    archived: { bg: "var(--border)", fg: "var(--ink-soft)" },
  };
  const s = style[status] ?? style.closed;
  return (
    <span className="chip" style={{ background: s.bg, color: s.fg, borderColor: "transparent" }}>
      {status}
    </span>
  );
}

export function Callout({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="panel p-4 mb-6" style={{ borderColor: "var(--accent)" }}>
      <h2 className="text-[13px] font-semibold mb-1">{title}</h2>
      <p className="muted text-[13px] mb-3 max-w-xl">{body}</p>
      <Link href={href} className="btn btn-primary text-[12px]">
        {cta}
      </Link>
    </div>
  );
}

export function LeadOnly({ what, href, label }: { what: string; href: string; label: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <p className="panel p-6 text-[13px] muted">
        {what} <Link href={href}>{label}</Link>
      </p>
    </div>
  );
}
