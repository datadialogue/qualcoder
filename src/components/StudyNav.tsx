"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Second navigation row, shown on every page inside a study. */
export function StudyNav({
  studyId,
  name,
  archived,
  isLead,
}: {
  studyId: string;
  name: string;
  archived: boolean;
  isLead: boolean;
}) {
  const pathname = usePathname() ?? "";
  const base = `/studies/${studyId}`;
  const links = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/codebook`, label: "Codebook" },
    { href: `${base}/rounds`, label: "Rounds" },
    { href: `${base}/analysis`, label: "Reliability" },
    { href: `${base}/export`, label: "Export" },
    ...(isLead ? [{ href: `${base}/settings`, label: "Data & settings" }] : []),
  ];

  return (
    <div
      className="flex items-center gap-1 px-4 h-10 border-b overflow-x-auto"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <Link href={base} className="text-[13px] font-semibold truncate max-w-xs mr-2">
        {name}
      </Link>
      {archived && <span className="chip mr-2">archived</span>}
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className="px-2.5 py-1 rounded text-[13px] whitespace-nowrap"
            style={{
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--ink-soft)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
