"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildSegments } from "@/lib/spans";
import type { ContextItem } from "@/lib/types";

export interface WorkUnit {
  id: string;
  external_id: string;
  text: string;
  meta: Record<string, string>;
  /** Read-only text shown above the unit, such as the post a comment replies to. */
  context: ContextItem[];
  position: number;
}

export interface WorkCode {
  id: string;
  name: string;
  color: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  example: string;
}

export interface WorkTheme {
  id: string;
  name: string;
  color: string;
  codes: WorkCode[];
}

export interface WorkAnnotation {
  id: string;
  unit_id: string;
  code_id: string;
  start_offset: number | null;
  end_offset: number | null;
  quote: string;
}

export interface WorkProgress {
  unit_id: string;
  status: "todo" | "in_progress" | "done";
  flagged: boolean;
  note: string;
}

interface Props {
  round: { id: string; number: number; name: string; status: string };
  study: { id: string; name: string };
  coderName: string;
  units: WorkUnit[];
  codebook: WorkTheme[];
  initialAnnotations: WorkAnnotation[];
  initialProgress: WorkProgress[];
  metaKeys: string[];
  /** Metadata key holding a link to the original item, if the study has one. */
  linkKey: string | null;
}

type Filter = "all" | "todo" | "done" | "flagged";

const UNFILED = "__unfiled__";

/**
 * Slots a newly created code into the palette without waiting for a reload.
 * A code with no theme goes to an "Unfiled" bucket, created on demand.
 */
function withNewCode(
  themes: WorkTheme[],
  code: WorkCode,
  themeId: string | null,
): WorkTheme[] {
  const target = themeId && themes.some((t) => t.id === themeId) ? themeId : UNFILED;
  if (themes.some((t) => t.id === target)) {
    return themes.map((t) =>
      t.id === target && !t.codes.some((c) => c.id === code.id)
        ? { ...t, codes: [...t.codes, code] }
        : t,
    );
  }
  return [...themes, { id: UNFILED, name: "Unfiled", color: "#94a3b8", codes: [code] }];
}

/** Absolute character offset of a DOM point inside the text container. */
function offsetIn(container: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function CodingWorkspace({
  round,
  study,
  coderName,
  units,
  codebook: initialCodebook,
  initialAnnotations,
  initialProgress,
  metaKeys,
  linkKey,
}: Props) {
  const [codebook, setCodebook] = useState(initialCodebook);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [progress, setProgress] = useState<Record<string, WorkProgress>>(() =>
    Object.fromEntries(initialProgress.map((p) => [p.unit_id, p])),
  );
  const [index, setIndex] = useState(() => {
    const firstTodo = units.findIndex(
      (u) => (initialProgress.find((p) => p.unit_id === u.id)?.status ?? "todo") !== "done",
    );
    return firstTodo === -1 ? 0 : firstTodo;
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [newCode, setNewCode] = useState({ name: "", themeId: "", definition: "" });
  const [codeNote, setCodeNote] = useState<string | null>(null);

  const textRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const newCodeRef = useRef<HTMLInputElement>(null);
  const readOnly = round.status === "closed";

  const flatCodes = useMemo(() => codebook.flatMap((t) => t.codes), [codebook]);
  const codeById = useMemo(() => new Map(flatCodes.map((c) => [c.id, c])), [flatCodes]);

  const unit = units[index];
  const unitAnnotations = useMemo(
    () => annotations.filter((a) => a.unit_id === unit?.id),
    [annotations, unit?.id],
  );
  const prog: WorkProgress = progress[unit?.id ?? ""] ?? {
    unit_id: unit?.id ?? "",
    status: "todo",
    flagged: false,
    note: "",
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return units.filter((u) => {
      const p = progress[u.id];
      const status = p?.status ?? "todo";
      if (filter === "todo" && status === "done") return false;
      if (filter === "done" && status !== "done") return false;
      if (filter === "flagged" && !p?.flagged) return false;
      if (q && !u.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [units, progress, filter, query]);

  const doneCount = units.filter((u) => progress[u.id]?.status === "done").length;

  /* ---------------------------------------------------------------- */

  const captureSelection = useCallback(() => {
    const container = textRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    let start = offsetIn(container, range.startContainer, range.startOffset);
    let end = offsetIn(container, range.endContainer, range.endOffset);
    if (end < start) [start, end] = [end, start];

    // Trim whitespace so a sloppy drag does not store leading/trailing blanks.
    const text = unit.text;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) {
      setSelection(null);
      return;
    }
    setSelection({ start, end, text: text.slice(start, end) });
  }, [unit?.text]);

  const applyCode = useCallback(
    async (codeId: string) => {
      if (!unit || readOnly) return;
      const span = selection;
      const optimisticId = `tmp-${Date.now()}-${Math.random()}`;
      const optimistic: WorkAnnotation = {
        id: optimisticId,
        unit_id: unit.id,
        code_id: codeId,
        start_offset: span ? span.start : null,
        end_offset: span ? span.end : null,
        quote: span ? span.text : "",
      };
      // Applying the same code to the same span twice is a no-op, matching the
      // unique index on the server.
      const duplicate = unitAnnotations.some(
        (a) =>
          a.code_id === codeId &&
          a.start_offset === optimistic.start_offset &&
          a.end_offset === optimistic.end_offset,
      );
      if (duplicate) {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
        return;
      }

      setAnnotations((prev) => [...prev, optimistic]);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      setSaving(true);
      try {
        const res = await fetch("/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roundId: round.id,
            unitId: unit.id,
            codeId,
            start: span ? span.start : null,
            end: span ? span.end : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not save that code.");
        setAnnotations((prev) =>
          prev.map((a) => (a.id === optimisticId ? data.annotation : a)),
        );
        setProgress((prev) => ({
          ...prev,
          [unit.id]: prev[unit.id] ?? { unit_id: unit.id, status: "in_progress", flagged: false, note: "" },
        }));
        setError(null);
      } catch (e) {
        setAnnotations((prev) => prev.filter((a) => a.id !== optimisticId));
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [unit, selection, unitAnnotations, round.id, readOnly],
  );

  const removeAnnotation = useCallback(
    async (id: string) => {
      if (readOnly) return;
      const previous = annotations;
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      try {
        const res = await fetch(`/api/annotations?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete.");
        setError(null);
      } catch (e) {
        setAnnotations(previous);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [annotations, readOnly],
  );

  /**
   * Creates a code from the palette and applies it straight away. Needing a
   * code that does not exist yet is ordinary during open coding, and the
   * selection is preserved across the form so the new code lands on the span
   * that prompted it.
   */
  const createCode = useCallback(async () => {
    const name = newCode.name.trim();
    if (!name || readOnly) return;
    setSaving(true);
    setCodeNote(null);
    try {
      const res = await fetch("/api/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          name,
          themeId: newCode.themeId || null,
          definition: newCode.definition.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create that code.");

      const created: WorkCode = {
        id: data.code.id,
        name: data.code.name,
        color: data.code.color,
        definition: data.code.definition ?? "",
        inclusion: data.code.inclusion ?? "",
        exclusion: data.code.exclusion ?? "",
        example: data.code.example ?? "",
      };
      setCodebook((prev) => withNewCode(prev, created, data.code.theme_id ?? null));
      setNewCode({ name: "", themeId: "", definition: "" });
      setCreatingCode(false);
      setError(null);
      if (data.existed) setCodeNote(data.message ?? null);
      await applyCode(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [newCode, readOnly, applyCode]);

  const patchProgress = useCallback(
    async (patch: Partial<WorkProgress>) => {
      if (!unit || readOnly) return;
      const previous = progress[unit.id];
      const next: WorkProgress = { ...prog, ...patch, unit_id: unit.id };
      setProgress((p) => ({ ...p, [unit.id]: next }));
      try {
        const res = await fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roundId: round.id, unitId: unit.id, ...patch }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not save progress.");
        setError(null);
      } catch (e) {
        setProgress((p) => {
          const copy = { ...p };
          if (previous) copy[unit.id] = previous;
          else delete copy[unit.id];
          return copy;
        });
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [unit, prog, progress, round.id, readOnly],
  );

  const goTo = useCallback(
    (delta: number) => {
      setSelection(null);
      setIndex((i) => Math.min(units.length - 1, Math.max(0, i + delta)));
    },
    [units.length],
  );

  const markDoneAndAdvance = useCallback(async () => {
    await patchProgress({ status: "done" });
    // Jump to the next unit still needing work rather than simply the next one.
    const nextTodo = units.findIndex(
      (u, i) => i > index && (progress[u.id]?.status ?? "todo") !== "done",
    );
    setIndex(nextTodo === -1 ? Math.min(index + 1, units.length - 1) : nextTodo);
    setSelection(null);
  }, [patchProgress, units, index, progress]);

  /* ------------------------------ keyboard ------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j") {
        e.preventDefault();
        goTo(1);
      } else if (e.key === "k") {
        e.preventDefault();
        goTo(-1);
      } else if (e.key === "d") {
        e.preventDefault();
        void markDoneAndAdvance();
      } else if (e.key === "f") {
        e.preventDefault();
        void patchProgress({ flagged: !prog.flagged });
      } else if (e.key === "n") {
        // Opens the palette's new-code form without losing the current selection.
        e.preventDefault();
        setCreatingCode(true);
        setTimeout(() => newCodeRef.current?.focus(), 0);
      } else if (e.key === "Escape") {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      } else if (/^[1-9]$/.test(e.key)) {
        const code = flatCodes[Number(e.key) - 1];
        if (code) {
          e.preventDefault();
          void applyCode(code.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, markDoneAndAdvance, patchProgress, prog.flagged, flatCodes, applyCode]);

  // Keep the active row visible when navigating by keyboard.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!unit) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="panel p-6">
          <h1 className="text-[15px] font-semibold mb-2">Nothing assigned to you</h1>
          <p className="muted text-[13px]">
            You are on round {round.number}, but no units are assigned to you in it.
          </p>
          <Link href={`/studies/${study.id}`} className="btn mt-3">
            Back to the study
          </Link>
        </div>
      </div>
    );
  }

  const segments = buildSegments(unit.text, unitAnnotations);

  return (
    <div className="h-screen flex flex-col">
      <header
        className="flex items-center gap-3 px-4 h-12 border-b shrink-0"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <Link href={`/studies/${study.id}`} className="text-[13px] font-semibold">
          ← <span className="muted font-normal">{study.name} /</span> Round {round.number}
          {round.name && <span className="muted font-normal"> · {round.name}</span>}
        </Link>
        <span className="chip num">
          {doneCount}/{units.length} done
        </span>
        {readOnly && (
          <span className="chip" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
            closed — read only
          </span>
        )}
        {saving && <span className="faint text-[11px]">saving…</span>}
        {error && (
          <span className="text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="faint text-[12px]">{coderName}</span>
          <Link href={`/studies/${study.id}/analysis/${round.id}`} className="btn text-[12px]">
            Reliability
          </Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-[260px_1fr_300px] min-h-0">
        {/* ------------------------------- queue ------------------------------ */}
        <aside
          className="border-r flex flex-col min-h-0"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
        >
          <div className="p-2 space-y-2 border-b" style={{ borderColor: "var(--border)" }}>
            <input
              className="input"
              placeholder="Search text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex gap-1">
              {(["all", "todo", "done", "flagged"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="btn text-[11px] px-2 py-0.5 flex-1 justify-center"
                  style={
                    filter === f
                      ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                      : undefined
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <ul ref={listRef} className="flex-1 overflow-y-auto">
            {visible.map((u) => {
              const p = progress[u.id];
              const active = u.id === unit.id;
              const n = annotations.filter((a) => a.unit_id === u.id).length;
              return (
                <li key={u.id}>
                  <button
                    data-active={active}
                    onClick={() => {
                      setIndex(units.findIndex((x) => x.id === u.id));
                      setSelection(null);
                    }}
                    className="w-full text-left px-2.5 py-2 border-b flex gap-2 items-start"
                    style={{
                      borderColor: "var(--border)",
                      background: active ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                      style={{
                        background:
                          p?.status === "done"
                            ? "var(--accent)"
                            : p?.status === "in_progress"
                              ? "var(--warn)"
                              : "var(--border-strong)",
                      }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-[12px] leading-snug line-clamp-2">{u.text}</span>
                      <span className="faint text-[10px] num">
                        #{u.position + 1}
                        {n > 0 && ` · ${n} code${n === 1 ? "" : "s"}`}
                        {p?.flagged && " · flagged"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="p-3 faint text-[12px]">Nothing matches that filter.</li>
            )}
          </ul>
        </aside>

        {/* ------------------------------- text ------------------------------ */}
        <section className="overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-6">
            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="chip num">
                #{unit.position + 1} of {units.length}
              </span>
              {metaKeys.map((k) =>
                unit.meta[k] ? (
                  <span key={k} className="chip">
                    <span className="faint">{k}</span> {unit.meta[k]}
                  </span>
                ) : null,
              )}
              {linkKey && /^https?:\/\//.test(unit.meta[linkKey] ?? "") && (
                <a
                  href={unit.meta[linkKey]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip"
                  style={{ color: "var(--accent)" }}
                >
                  open original ↗
                </a>
              )}
            </div>

            {/* Context is read-only and sits outside the text container, so it
                can never be selected into a span or shift any offset. */}
            {unit.context?.length > 0 && (
              <div className="space-y-2 mb-4">
                {unit.context.map((c, i) => (
                  <ContextBlock key={i} item={c} />
                ))}
              </div>
            )}

            <div
              ref={textRef}
              onMouseUp={captureSelection}
              onKeyUp={captureSelection}
              className="coding-text select-text mb-4"
            >
              {segments.map((seg) => {
                const codes = seg.codeIds.map((id) => codeById.get(id)).filter(Boolean) as WorkCode[];
                if (codes.length === 0) {
                  return (
                    <span key={seg.start} data-start={seg.start}>
                      {seg.text}
                    </span>
                  );
                }
                return (
                  <span
                    key={seg.start}
                    data-start={seg.start}
                    title={codes.map((c) => c.name).join(" · ")}
                    style={{
                      background: `color-mix(in srgb, ${codes[0].color} 16%, transparent)`,
                      boxShadow: codes
                        .map((c, i) => `inset 0 -${(i + 1) * 2}px 0 0 ${c.color}`)
                        .reverse()
                        .join(", "),
                      borderRadius: "2px",
                    }}
                  >
                    {seg.text}
                  </span>
                );
              })}
            </div>

            <div
              className="text-[12px] px-3 py-2 rounded mb-4"
              style={{
                background: selection ? "var(--accent-soft)" : "var(--panel)",
                color: selection ? "var(--accent)" : "var(--ink-faint)",
                border: "1px solid var(--border)",
              }}
            >
              {selection ? (
                <>
                  Selected <strong>&ldquo;{selection.text}&rdquo;</strong> — now pick a code to
                  attach it to.
                </>
              ) : (
                <>
                  Select text to code a span, or pick a code with nothing selected to apply it to
                  the whole comment.
                </>
              )}
            </div>

            <div className="mb-4">
              <h3 className="label">
                Your codes on this unit ({unitAnnotations.length})
              </h3>
              {unitAnnotations.length === 0 ? (
                <p className="faint text-[12px]">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {unitAnnotations.map((a) => {
                    const c = codeById.get(a.code_id);
                    return (
                      <li
                        key={a.id}
                        className="flex items-start gap-2 text-[12px] panel px-2 py-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
                          style={{ background: c?.color ?? "var(--border-strong)" }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="font-medium">{c?.name ?? "unknown code"}</span>
                          {a.start_offset === null ? (
                            <span className="faint"> · whole comment</span>
                          ) : (
                            <span className="muted"> · &ldquo;{a.quote}&rdquo;</span>
                          )}
                        </span>
                        {!readOnly && (
                          <button
                            onClick={() => void removeAnnotation(a.id)}
                            className="faint hover:text-[var(--danger)] shrink-0"
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mb-4">
              <label className="label">Note on this unit</label>
              <textarea
                className="textarea"
                rows={2}
                defaultValue={prog.note}
                disabled={readOnly}
                placeholder="Uncertainty, edge cases, anything to raise in adjudication…"
                onBlur={(e) => {
                  if (e.target.value !== prog.note) void patchProgress({ note: e.target.value });
                }}
              />
            </div>

            <div className="flex items-center gap-2 pb-8">
              <button className="btn" onClick={() => goTo(-1)} disabled={index === 0}>
                ← Previous
              </button>
              <button
                className="btn"
                onClick={() => goTo(1)}
                disabled={index === units.length - 1}
              >
                Next →
              </button>
              <button
                className="btn"
                disabled={readOnly}
                onClick={() => void patchProgress({ flagged: !prog.flagged })}
                style={
                  prog.flagged
                    ? { background: "var(--warn-soft)", color: "var(--warn)", borderColor: "var(--warn)" }
                    : undefined
                }
              >
                {prog.flagged ? "Flagged" : "Flag"}
              </button>
              <button
                className="btn btn-primary ml-auto"
                disabled={readOnly}
                onClick={() => void markDoneAndAdvance()}
              >
                {prog.status === "done" ? "Done ✓ — next" : "Mark done"}
              </button>
            </div>

            <p className="faint text-[11px] pb-8">
              <strong>j</strong>/<strong>k</strong> move · <strong>1</strong>–<strong>9</strong>{" "}
              apply code · <strong>n</strong> new code · <strong>d</strong> mark done ·{" "}
              <strong>f</strong> flag · <strong>esc</strong> clear selection
            </p>
          </div>
        </section>

        {/* ----------------------------- palette ----------------------------- */}
        <aside
          className="border-l overflow-y-auto"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
        >
          <div className="p-3">
            <h2 className="label">Codebook</h2>
            {flatCodes.length === 0 && (
              <p className="faint text-[12px] mb-3">
                No codes yet. Add the first one below, or ask the project lead to set up the
                codebook.
              </p>
            )}
            {codebook.map((theme) => (
              <div key={theme.id} className="mb-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: theme.color }}
                  />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide faint">
                    {theme.name}
                  </h3>
                </div>
                <ul className="space-y-1">
                  {theme.codes.map((code) => {
                    const shortcutIndex = flatCodes.findIndex((c) => c.id === code.id);
                    const applied = unitAnnotations.some((a) => a.code_id === code.id);
                    return (
                      <li key={code.id}>
                        <button
                          onClick={() => void applyCode(code.id)}
                          disabled={readOnly}
                          title={
                            [code.definition, code.inclusion && `Apply when: ${code.inclusion}`,
                              code.exclusion && `Not when: ${code.exclusion}`]
                              .filter(Boolean)
                              .join("\n\n") || code.name
                          }
                          className="w-full text-left px-2 py-1.5 rounded border text-[12px] flex items-start gap-1.5 disabled:opacity-50"
                          style={{
                            borderColor: applied ? code.color : "var(--border)",
                            background: applied
                              ? `color-mix(in srgb, ${code.color} 14%, transparent)`
                              : "transparent",
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
                            style={{ background: code.color }}
                          />
                          <span className="flex-1 leading-snug">{code.name}</span>
                          {shortcutIndex < 9 && (
                            <kbd className="faint text-[10px] num shrink-0">
                              {shortcutIndex + 1}
                            </kbd>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {!readOnly && (
              <div
                className="pt-3 mt-1 border-t"
                style={{ borderColor: "var(--border)" }}
              >
                {creatingCode ? (
                  <div className="space-y-2">
                    <div>
                      <label className="label">New code</label>
                      <input
                        ref={newCodeRef}
                        className="input"
                        value={newCode.name}
                        placeholder="Name it after what you saw"
                        onChange={(e) => setNewCode((c) => ({ ...c, name: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void createCode();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setCreatingCode(false);
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="label">Theme</label>
                      <select
                        className="select"
                        value={newCode.themeId}
                        onChange={(e) => setNewCode((c) => ({ ...c, themeId: e.target.value }))}
                      >
                        <option value="">Unfiled</option>
                        {codebook
                          .filter((t) => t.id !== UNFILED)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Definition (optional)</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={newCode.definition}
                        placeholder="What would make you apply this again?"
                        onChange={(e) =>
                          setNewCode((c) => ({ ...c, definition: e.target.value }))
                        }
                      />
                    </div>
                    <p className="faint text-[11px]">
                      {selection ? (
                        <>
                          Will be applied to{" "}
                          <span className="muted">&ldquo;{selection.text}&rdquo;</span>.
                        </>
                      ) : (
                        "Nothing is selected, so this will be applied to the whole comment."
                      )}
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        className="btn btn-primary text-[12px] flex-1 justify-center"
                        disabled={saving || !newCode.name.trim()}
                        onClick={() => void createCode()}
                      >
                        {saving ? "Saving…" : "Create and apply"}
                      </button>
                      <button
                        className="btn text-[12px]"
                        onClick={() => {
                          setCreatingCode(false);
                          setCodeNote(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="faint text-[11px]">
                      New codes are flagged for the lead to review before the next round.
                    </p>
                  </div>
                ) : (
                  <button
                    className="btn text-[12px] w-full justify-center"
                    onClick={() => {
                      setCreatingCode(true);
                      setTimeout(() => newCodeRef.current?.focus(), 0);
                    }}
                  >
                    + New code <kbd className="faint text-[10px]">n</kbd>
                  </button>
                )}
                {codeNote && (
                  <p className="text-[11px] mt-2" style={{ color: "var(--warn)" }}>
                    {codeNote}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A piece of surrounding context, collapsed when long so the unit stays in view. */
function ContextBlock({ item }: { item: ContextItem }) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 280;
  return (
    <div
      className="text-[13px] px-3 py-2 rounded"
      style={{ background: "var(--panel)", border: "1px solid var(--border)", borderLeft: "3px solid var(--ink-faint)" }}
    >
      {item.label && <div className="label mb-0.5">{item.label}</div>}
      <p className={`muted whitespace-pre-line ${long && !open ? "line-clamp-3" : ""}`}>{item.text}</p>
      {long && (
        <button className="faint text-[11px] mt-1 underline" onClick={() => setOpen(!open)}>
          {open ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}
