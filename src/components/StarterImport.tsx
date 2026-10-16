"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildUnits,
  chunkUnits,
  defaultMapping,
  metaKeysFor,
  parseStarterFile,
  REDDIT_FIELDS,
  StarterError,
  type ImportMapping,
  type ParsedStarter,
} from "@/lib/starter";
import { countCodes, parseCodebookText, type CodebookThemeInput } from "@/lib/codebook-parse";

const FORMAT_LABEL: Record<ParsedStarter["format"], string> = {
  csv: "CSV",
  json: "JSON",
  jsonl: "JSON Lines",
  "reddit-listing": "Reddit listing",
};

type Props =
  | { mode: "create" }
  | { mode: "append"; studyId: string; initialMapping?: Partial<ImportMapping> };

/**
 * Reads a starter file in the browser, lets the lead check how it maps onto
 * units, and uploads it in batches. Parsing here rather than on the server is
 * what lets a large Reddit dump through: request bodies are capped well below
 * the size of a typical export.
 */
export function StarterImport(props: Props) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedStarter | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [codebookText, setCodebookText] = useState("");
  const [useFileCodebook, setUseFileCodebook] = useState(true);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [submitError, setSubmitError] = useState<React.ReactNode>(null);
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setReadError(null);
    setResult(null);
    setSubmitError(null);
    setParsed(null);
    setMapping(null);
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    try {
      const p = parseStarterFile(await file.text());
      if (p.records.length === 0) throw new StarterError("No records were found in that file.");
      const hints =
        props.mode === "append" ? { ...props.initialMapping, ...p.mapping } : p.mapping;
      setParsed(p);
      setMapping(defaultMapping({ ...p, mapping: hints }));
      if (props.mode === "create") {
        setName(p.study?.name ?? file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
        setDescription(p.study?.description ?? "");
        setUseFileCodebook(p.codebook.length > 0);
      }
    } catch (err) {
      setReadError(
        err instanceof StarterError
          ? err.message
          : `Could not read that file: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setReading(false);
    }
  }

  const built = useMemo(() => {
    if (!parsed || !mapping) return null;
    try {
      return { ...buildUnits(parsed, mapping), error: null };
    } catch (err) {
      return { units: [], stats: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [parsed, mapping]);

  const pastedCodebook = useMemo(() => parseCodebookText(codebookText), [codebookText]);
  const codebook: CodebookThemeInput[] =
    useFileCodebook && parsed?.codebook.length ? parsed.codebook : pastedCodebook;

  const kinds = useMemo(() => {
    if (!parsed || mapping?.preset !== "reddit") return null;
    let comments = 0;
    let posts = 0;
    for (const r of parsed.records) {
      const k = (r.kind ?? r.type ?? "").toLowerCase();
      if (k === "t1" || k === "comment" || (!k && r.body !== undefined)) comments++;
      else posts++;
    }
    return { comments, posts };
  }, [parsed, mapping?.preset]);

  const set = (patch: Partial<ImportMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

  async function submit() {
    if (!parsed || !mapping || !built || built.error || built.units.length === 0) return;
    setSubmitError(null);
    setResult(null);

    let studyId: string;
    if (props.mode === "create") {
      if (!name.trim()) {
        setSubmitError("Give the study a name.");
        return;
      }
      const res = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          source: mapping.preset === "reddit" ? "reddit" : parsed.format === "csv" ? "csv" : "json",
          settings: {
            displayKeys: mapping.displayKeys,
            linkKey: mapping.preset === "reddit" ? "permalink" : undefined,
            mapping,
          },
          codebook,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error ?? "Could not create the study.");
        return;
      }
      studyId = data.id;
    } else {
      studyId = props.studyId;
    }

    const chunks = chunkUnits(built.units);
    let inserted = 0;
    let updated = 0;
    setProgress({ done: 0, total: chunks.length });
    for (let i = 0; i < chunks.length; i++) {
      try {
        const res = await fetch(`/api/studies/${studyId}/units`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ units: chunks[i] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
        inserted += data.inserted ?? 0;
        updated += data.updated ?? 0;
        setProgress({ done: i + 1, total: chunks.length });
      } catch (err) {
        setProgress(null);
        const message = err instanceof Error ? err.message : String(err);
        setSubmitError(
          <>
            The upload stopped at batch {i + 1} of {chunks.length}: {message}{" "}
            {props.mode === "create" ? "The study was created with the data sent so far. " : ""}
            Upload the same file again from{" "}
            <Link href={`/studies/${studyId}/settings`} style={{ color: "var(--accent)" }}>
              the study&rsquo;s settings
            </Link>{" "}
            — units already imported are matched and updated, not duplicated.
          </>,
        );
        return;
      }
    }
    setProgress(null);

    if (props.mode === "create") {
      router.push(`/studies/${studyId}`);
    } else {
      setResult(
        `Imported ${inserted.toLocaleString()} new unit(s)` +
          (updated ? ` and updated ${updated.toLocaleString()} existing one(s).` : "."),
      );
      router.refresh();
    }
  }

  const metaKeys = mapping ? metaKeysFor(mapping) : [];
  const preview = built?.units.slice(0, 3) ?? [];
  const busy = progress !== null || reading;

  return (
    <div className="space-y-4">
      <Section
        n={1}
        title="Starter file"
        hint="CSV, JSON, JSON Lines, or a Reddit export — including a thread or listing saved from reddit.com/….json. A JSON bundle can also carry the study's name and starting codebook."
      >
        <input
          className="input"
          type="file"
          accept=".csv,.json,.jsonl,.ndjson,.txt,text/csv,application/json"
          onChange={(e) => onFile(e.target.files?.[0])}
          disabled={busy}
        />
        {reading && <p className="faint text-[12px] mt-2">Reading {fileName}…</p>}
        {readError && (
          <p className="text-[12px] mt-2" style={{ color: "var(--danger)" }}>
            {readError}
          </p>
        )}
        {parsed && (
          <p className="muted text-[12px] mt-2 num">
            {parsed.records.length.toLocaleString()} records in <strong>{fileName}</strong> (
            {FORMAT_LABEL[parsed.format]}) · {parsed.fields.length} fields
            {parsed.codebook.length > 0 &&
              ` · codebook with ${countCodes(parsed.codebook)} codes in ${parsed.codebook.length} themes`}
          </p>
        )}
      </Section>

      {parsed && mapping && (
        <Section
          n={2}
          title="What gets coded"
          hint="Each record becomes one unit. Check the preview below before importing."
        >
          <div className="flex gap-4 mb-3 text-[13px]">
            <Radio
              checked={mapping.preset === "reddit"}
              onChange={() => setMapping(defaultMapping({ ...parsed, mapping: { preset: "reddit" } }))}
              label="Reddit posts and comments"
            />
            <Radio
              checked={mapping.preset === "generic"}
              onChange={() => setMapping(defaultMapping({ ...parsed, mapping: { preset: "generic" } }))}
              label="Generic table"
            />
          </div>

          {mapping.preset === "reddit" ? (
            <div className="space-y-3">
              <div>
                <span className="label">Units</span>
                <div className="flex flex-wrap gap-4 text-[13px]">
                  <Radio
                    checked={mapping.redditInclude === "both"}
                    onChange={() => set({ redditInclude: "both" })}
                    label={`Posts and comments${kinds ? ` (${(kinds.posts + kinds.comments).toLocaleString()})` : ""}`}
                  />
                  <Radio
                    checked={mapping.redditInclude === "comments"}
                    onChange={() => set({ redditInclude: "comments" })}
                    label={`Comments only${kinds ? ` (${kinds.comments.toLocaleString()})` : ""}`}
                  />
                  <Radio
                    checked={mapping.redditInclude === "posts"}
                    onChange={() => set({ redditInclude: "posts" })}
                    label={`Posts only${kinds ? ` (${kinds.posts.toLocaleString()})` : ""}`}
                  />
                </div>
                <p className="faint text-[12px] mt-1">
                  A comment&rsquo;s text is its body; a post&rsquo;s is its title and self-text.
                  Items left out can still appear as context.
                </p>
              </div>
              <Check
                checked={mapping.redditContext}
                onChange={(v) => set({ redditContext: v })}
                label="Show the original post and the parent comment above each comment, when they are in the file"
              />
              <Check
                checked={mapping.skipRemoved}
                onChange={(v) => set({ skipRemoved: v })}
                label='Skip items whose text is "[deleted]" or "[removed]"'
              />
              <details>
                <summary className="label cursor-pointer">
                  Extra fields to keep ({mapping.keepFields.length} selected)
                </summary>
                <p className="faint text-[12px] my-1">
                  Always kept: {REDDIT_FIELDS.join(", ")}. Add raw fields here to sample, display or
                  export by them.
                </p>
                <Chips
                  options={parsed.fields.filter((f) => !(REDDIT_FIELDS as readonly string[]).includes(f))}
                  value={mapping.keepFields}
                  onChange={(keepFields) => set({ keepFields })}
                />
              </details>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="label">Text to code</span>
                <Chips
                  ordered
                  options={parsed.fields}
                  value={mapping.textFields}
                  onChange={(textFields) =>
                    set({
                      textFields,
                      keepFields: parsed.fields.filter((f) => !textFields.includes(f)),
                    })
                  }
                />
                <p className="faint text-[12px] mt-1">
                  Pick more than one to join them, separated by a blank line, in the order picked.
                </p>
              </div>
              <div>
                <span className="label">Unique id</span>
                <Chips
                  options={parsed.fields}
                  value={mapping.idFields}
                  onChange={(idFields) => set({ idFields })}
                />
                <p className="faint text-[12px] mt-1">
                  Lets a corrected file be re-imported over this one. Leave empty to use the row
                  number.
                </p>
              </div>
              <details>
                <summary className="label cursor-pointer">
                  Fields kept as metadata ({mapping.keepFields.length} of{" "}
                  {parsed.fields.length - mapping.textFields.length})
                </summary>
                <Chips
                  options={parsed.fields.filter((f) => !mapping.textFields.includes(f))}
                  value={mapping.keepFields}
                  onChange={(keepFields) => set({ keepFields })}
                />
              </details>
              <Check
                checked={mapping.skipRemoved}
                onChange={(v) => set({ skipRemoved: v })}
                label='Skip rows whose text is "[deleted]" or "[removed]"'
              />
            </div>
          )}

          {props.mode === "create" && (
            <div className="mt-3">
              <span className="label">Shown above each unit while coding</span>
              <Chips
                options={metaKeys}
                value={mapping.displayKeys.filter((k) => metaKeys.includes(k))}
                onChange={(displayKeys) => set({ displayKeys })}
              />
              <p className="faint text-[12px] mt-1">
                Changeable later. Showing the author is off by default, to keep attention on the
                text rather than the person.
              </p>
            </div>
          )}
        </Section>
      )}

      {built && (
        <Section n={3} title="Preview">
          {built.error ? (
            <p className="text-[13px]" style={{ color: "var(--danger)" }}>
              {built.error}
            </p>
          ) : (
            <>
              <p className="text-[13px] mb-3 num">
                <strong>{built.units.length.toLocaleString()} units</strong>
                {built.stats && (
                  <span className="muted">
                    {" "}
                    from {built.stats.records.toLocaleString()} records
                    {skipped(built.stats)}
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {preview.map((u) => (
                  <div key={u.external_id} className="panel p-3">
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      <span className="chip font-mono text-[11px]">{u.external_id}</span>
                      {mapping?.displayKeys.map((k) =>
                        u.meta[k] ? (
                          <span key={k} className="chip">
                            <span className="faint">{k}</span> {u.meta[k]}
                          </span>
                        ) : null,
                      )}
                    </div>
                    {u.context.map((c, i) => (
                      <p
                        key={i}
                        className="faint text-[12px] mb-1 pl-2 line-clamp-2"
                        style={{ borderLeft: "2px solid var(--border)" }}
                      >
                        <span className="label mr-1">{c.label}</span>
                        {c.text}
                      </p>
                    ))}
                    <p className="text-[13px] whitespace-pre-line line-clamp-4">{u.text}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {parsed && props.mode === "create" && (
        <>
          <Section n={4} title="Study">
            <div className="space-y-2">
              <div>
                <label className="label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <textarea
                  className="textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Research question, data source, collection dates…"
                />
              </div>
            </div>
          </Section>

          <Section
            n={5}
            title="Starting codebook (optional)"
            hint="You can also build it later on the Codebook page, or let coders add codes as they work."
          >
            {parsed.codebook.length > 0 && (
              <Check
                checked={useFileCodebook}
                onChange={setUseFileCodebook}
                label={`Use the codebook in the starter file (${countCodes(parsed.codebook)} codes in ${parsed.codebook.length} themes)`}
              />
            )}
            {!(useFileCodebook && parsed.codebook.length > 0) && (
              <>
                <textarea
                  className="textarea font-mono text-[12px]"
                  rows={6}
                  value={codebookText}
                  onChange={(e) => setCodebookText(e.target.value)}
                  placeholder={
                    "theme,code,definition\n" +
                    "Tone,Sarcasm,Says the opposite of what is meant for effect\n" +
                    "Tone,Hostility,Attacks or belittles another person\n" +
                    "Stance,Agrees with the post,Explicitly endorses the post's claim"
                  }
                />
                <div className="flex items-center gap-3 mt-1.5">
                  <label className="btn text-[12px] cursor-pointer">
                    Load from a file
                    <input
                      type="file"
                      className="sr-only"
                      accept=".csv,.tsv,.txt,.json"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) setCodebookText(await f.text());
                      }}
                    />
                  </label>
                  <span className="faint text-[12px] num">
                    {codebookText.trim()
                      ? `${countCodes(pastedCodebook)} codes in ${pastedCodebook.filter((t) => t.name).length} themes recognised`
                      : "Rows of theme, code, definition — or JSON. Optional inclusion, exclusion and example columns."}
                  </span>
                </div>
              </>
            )}
          </Section>
        </>
      )}

      {parsed && (
        <div className="flex items-center gap-3">
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !built || !!built.error || built.units.length === 0}
          >
            {progress
              ? `Uploading ${progress.done}/${progress.total}…`
              : props.mode === "create"
                ? `Create study and import ${built?.units.length.toLocaleString() ?? 0} units`
                : `Import ${built?.units.length.toLocaleString() ?? 0} units`}
          </button>
          {progress && (
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-full"
                style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent)" }}
              />
            </div>
          )}
        </div>
      )}
      {submitError && (
        <p className="text-[13px]" style={{ color: "var(--danger)" }}>
          {submitError}
        </p>
      )}
      {result && (
        <p className="text-[13px]" style={{ color: "var(--accent)" }}>
          {result}
        </p>
      )}
    </div>
  );
}

function skipped(s: NonNullable<ReturnType<typeof buildUnits>["stats"]>): string {
  const parts = [
    s.excluded && `${s.excluded.toLocaleString()} left out by type`,
    s.removed && `${s.removed.toLocaleString()} deleted or removed`,
    s.empty && `${s.empty.toLocaleString()} without text`,
    s.duplicate && `${s.duplicate.toLocaleString()} duplicate ids`,
  ].filter(Boolean);
  return parts.length ? ` — skipped ${parts.join(", ")}` : "";
}

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-[13px] font-semibold mb-0.5">
        <span className="faint num mr-1.5">{n}</span>
        {title}
      </h2>
      {hint && <p className="muted text-[12px] mb-3">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </section>
  );
}

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Multi-select as toggleable chips; selection order is preserved. */
function Chips({
  options,
  value,
  onChange,
  ordered = false,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Number the selected chips, for choices where order matters. */
  ordered?: boolean;
}) {
  if (options.length === 0) return <p className="faint text-[12px]">Nothing to choose from.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        const order = value.indexOf(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className="chip cursor-pointer"
            style={
              on
                ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                : undefined
            }
          >
            {ordered && on && value.length > 1 && <span className="num">{order + 1}</span>}
            {o}
          </button>
        );
      })}
    </div>
  );
}
