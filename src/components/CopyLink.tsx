"use client";

import { useState } from "react";

/** Invite links are bearer credentials, so they are copied rather than
 *  displayed in full by default. */
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);

  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        className="btn text-[11px] py-0.5"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setShown(true);
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy invite link"}
      </button>
      <button className="faint text-[11px] underline" onClick={() => setShown((s) => !s)}>
        {shown ? "hide" : "show"}
      </button>
      {shown && (
        <code className="text-[10px] muted break-all select-all">{url}</code>
      )}
    </span>
  );
}
