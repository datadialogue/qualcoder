"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Everything else lives inside a study and gets its own row from StudyNav.
const links = [{ href: "/", label: "Studies" }];

export function Nav({ coder }: { coder: { name: string; role: string } | null }) {
  const pathname = usePathname();
  // The coding workspace uses the full viewport height; its own header suffices.
  if (pathname?.startsWith("/code/")) return null;

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-1 px-4 h-12 border-b"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <Link href="/" className="text-[13px] font-semibold tracking-tight mr-3">
        Qualitative Coding
      </Link>
      <nav className="flex items-center gap-1">
        {links.map((l) => {
          const active =
            l.href === "/"
              ? pathname === "/" || pathname?.startsWith("/studies")
              : pathname?.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className="px-2.5 py-1 rounded text-[13px]"
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
        {coder?.role === "lead" && (
          <Link
            href="/admin"
            className="px-2.5 py-1 rounded text-[13px]"
            style={{
              background: pathname?.startsWith("/admin") ? "var(--accent-soft)" : "transparent",
              color: pathname?.startsWith("/admin") ? "var(--accent)" : "var(--ink-soft)",
            }}
          >
            Admin
          </Link>
        )}
      </nav>
      <div className="ml-auto text-[12px] faint">
        {coder ? (
          <span>
            {coder.name}
            {coder.role === "lead" && <span className="ml-1.5 chip">lead</span>}
          </span>
        ) : (
          <span>not signed in</span>
        )}
      </div>
    </header>
  );
}
