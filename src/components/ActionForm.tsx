"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

/**
 * Wraps a server action with pending state and inline feedback, so every form
 * in the app reports failures rather than silently doing nothing.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClassName = "btn btn-primary",
  confirm,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  className?: string;
  submitLabel: string;
  submitClassName?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, null);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button className={submitClassName} disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </button>
      {state?.error && (
        <p className="text-[12px] mt-1.5" style={{ color: "var(--danger)" }}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="text-[12px] mt-1.5" style={{ color: "var(--accent)" }}>
          {state.ok}
        </p>
      )}
    </form>
  );
}
