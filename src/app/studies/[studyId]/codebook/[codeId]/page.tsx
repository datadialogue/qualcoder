import Link from "next/link";
import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getRounds, getStudy } from "@/lib/queries";
import { buildSegments } from "@/lib/spans";
import { SignedOut } from "@/components/SignedOut";
import type { ContextItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 40;

interface Application {
  id: string;
  round_id: string;
  round_number: number;
  unit_id: string;
  coder_id: string;
  coder_name: string;
  start_offset: number | null;
  end_offset: number | null;
  memo: string;
  code_id: string;
  original_code_id: string | null;
  original_name: string | null;
}

/**
 * Everything coded with one code: the posts, the exact text highlighted, who
 * applied it in which round, and which other codes tend to land on the same
 * posts -- the quickest way to spot two codes that are really one.
 *
 * Coders see closed rounds plus their own work in open ones, so exploring
 * cannot show them a colleague's coding while they are still coding the same
 * posts independently. Leads see everything.
 */
export default async function CodeExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string; codeId: string }>;
  searchParams: Promise<{ round?: string; coder?: string; limit?: string }>;
}) {
  const { studyId, codeId } = await params;
  const sp = await searchParams;
  const viewer = await currentCoder();
  if (!viewer) return <SignedOut />;
  if (!/^[0-9a-f-]{36}$/i.test(codeId)) notFound();
  const base = `/studies/${studyId}/codebook`;

  const [study, codeRows, rounds] = await Promise.all([
    getStudy(studyId),
    sql<
      Array<{
        id: string;
        name: string;
        color: string;
        definition: string;
        inclusion: string;
        exclusion: string;
        theme_name: string | null;
        archived: boolean;
        merged_into: string | null;
        merged_at: string | null;
        merged_into_name: string | null;
      }>
    >`
      SELECT c.id, c.name, c.color, c.definition, c.inclusion, c.exclusion, c.archived,
             c.merged_into, c.merged_at, t.name AS theme_name, m.name AS merged_into_name
      FROM codes c
      LEFT JOIN themes t ON t.id = c.theme_id
      LEFT JOIN codes m ON m.id = c.merged_into
      WHERE c.id = ${codeId} AND c.study_id = ${studyId}
    `,
    getRounds(studyId),
  ]);
  const code = codeRows[0];
  if (!study || !code) notFound();

  const isLead = viewer.role === "lead";
  const roundId = rounds.some((r) => r.id === sp.round) ? sp.round! : null;
  const coderId = sp.coder && /^[0-9a-f-]{36}$/i.test(sp.coder) ? sp.coder : null;
  const limit = Math.max(PAGE, Math.min(2000, Number(sp.limit) || PAGE));
  const visible = isLead ? sql`true` : sql`(r.status = 'closed' OR a.coder_id = ${viewer.id})`;

  const [apps, mergedFrom, coders] = await Promise.all([
    // A merged-away code is explored through the annotations originally given it.
    sql<Application[]>`
      SELECT a.id, a.round_id, r.number AS round_number, a.unit_id, a.coder_id,
             co.name AS coder_name, a.start_offset, a.end_offset, a.memo,
             a.code_id, a.original_code_id, oc.name AS original_name
      FROM annotations a
      JOIN rounds r ON r.id = a.round_id
      JOIN coders co ON co.id = a.coder_id
      LEFT JOIN codes oc ON oc.id = a.original_code_id
      WHERE r.study_id = ${studyId}
        AND (a.code_id = ${codeId} OR a.original_code_id = ${codeId})
        AND ${visible}
        AND ${roundId ? sql`a.round_id = ${roundId}` : sql`true`}
        AND ${coderId ? sql`a.coder_id = ${coderId}` : sql`true`}
      ORDER BY r.number, a.start_offset NULLS FIRST
    `,
    sql<{ id: string; name: string; color: string }[]>`
      SELECT id, name, color FROM codes WHERE merged_into = ${codeId} ORDER BY merged_at, name
    `,
    sql<{ id: string; name: string }[]>`
      SELECT DISTINCT co.id, co.name
      FROM annotations a JOIN rounds r ON r.id = a.round_id JOIN coders co ON co.id = a.coder_id
      WHERE r.study_id = ${studyId} AND (a.code_id = ${codeId} OR a.original_code_id = ${codeId})
        AND ${visible}
      ORDER BY co.name
    `,
  ]);

  // Group by post. Posts most coders agreed on come first.
  const byUnit = new Map<string, Application[]>();
  for (const a of apps) {
    const list = byUnit.get(a.unit_id) ?? [];
    list.push(a);
    byUnit.set(a.unit_id, list);
  }
  const unitIds = [...byUnit.keys()].sort(
    (x, y) =>
      new Set(byUnit.get(y)!.map((a) => a.coder_id)).size -
      new Set(byUnit.get(x)!.map((a) => a.coder_id)).size,
  );
  const shownIds = unitIds.slice(0, limit);

  // Other codes the same coder put on the same post in the same round.
  const [units, cooc] = await Promise.all([
    sql<Array<{ id: string; external_id: string; text: string; meta: Record<string, string>; context: ContextItem[] }>>`
      SELECT id, external_id, text, meta, context FROM units WHERE id = ANY(${shownIds}::uuid[])
    `,
    apps.length === 0
      ? Promise.resolve([])
      : sql<Array<{ unit_id: string; code_id: string; name: string; color: string }>>`
          SELECT DISTINCT b.unit_id, b.code_id, c.name, c.color
          FROM annotations a
          JOIN annotations b
            ON b.round_id = a.round_id AND b.unit_id = a.unit_id AND b.coder_id = a.coder_id
           AND b.code_id <> a.code_id
          JOIN codes c ON c.id = b.code_id
          WHERE a.id = ANY(${apps.map((a) => a.id)}::uuid[])
        `,
  ]);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const coocCounts = new Map<string, { id: string; name: string; color: string; posts: number }>();
  const othersOnUnit = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const r of cooc) {
    const entry = coocCounts.get(r.code_id) ?? { id: r.code_id, name: r.name, color: r.color, posts: 0 };
    entry.posts++;
    coocCounts.set(r.code_id, entry);
    const list = othersOnUnit.get(r.unit_id) ?? [];
    list.push({ id: r.code_id, name: r.name, color: r.color });
    othersOnUnit.set(r.unit_id, list);
  }
  const related = [...coocCounts.values()].sort((a, b) => b.posts - a.posts).slice(0, 12);
  const liveId = code.merged_into ?? code.id;

  const displayKeys = study.settings.displayKeys ?? [];
  const linkKey = study.settings.linkKey;
  const nCoders = new Set(apps.map((a) => a.coder_id)).size;
  const filterHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (roundId) q.set("round", roundId);
    if (coderId) q.set("coder", coderId);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-[12px] mb-1">
          <Link href={base}>← Codebook</Link>
        </p>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: code.color }} />
          <h1 className="text-xl font-semibold tracking-tight">{code.name}</h1>
          {code.theme_name && <span className="chip">{code.theme_name}</span>}
          {code.archived && !code.merged_into && <span className="chip">archived</span>}
        </div>
        {code.merged_into && (
          <p
            className="panel px-3 py-2 text-[13px] mt-3"
            style={{ background: "var(--warn-soft)", borderColor: "transparent" }}
          >
            Merged into <Link href={`${base}/${code.merged_into}`}>{code.merged_into_name}</Link>
            {code.merged_at && ` on ${new Date(code.merged_at).toLocaleDateString()}`}. Below are the
            annotations coders originally gave this code; they now count as{" "}
            {code.merged_into_name}.
          </p>
        )}
        {code.definition && <p className="text-[13px] mt-2 max-w-3xl">{code.definition}</p>}
        <dl className="text-[12px] mt-1 space-y-0.5 max-w-3xl">
          {code.inclusion && (
            <div>
              <dt className="label inline mr-1">Apply when</dt>
              <dd className="inline muted">{code.inclusion}</dd>
            </div>
          )}
          {code.exclusion && (
            <div>
              <dt className="label inline mr-1">Do not apply when</dt>
              <dd className="inline muted">{code.exclusion}</dd>
            </div>
          )}
        </dl>
        {mergedFrom.length > 0 && (
          <p className="text-[12px] mt-2 flex flex-wrap items-center gap-1.5">
            <span className="faint">Merged from</span>
            {mergedFrom.map((c) => (
              <Link key={c.id} href={`${base}/${c.id}`} className="chip" style={{ borderColor: c.color }}>
                {c.name}
              </Link>
            ))}
            <Link href={`${base}/merges`} className="faint">
              history
            </Link>
          </p>
        )}
      </header>

      <form className="flex flex-wrap items-end gap-2 mb-4" method="get">
        <div>
          <label className="label">Round</label>
          <select className="select" name="round" defaultValue={roundId ?? ""}>
            <option value="">All rounds</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                Round {r.number}
                {r.name ? ` · ${r.name}` : ""}
                {r.status !== "closed" && !isLead ? " (your coding only)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Coder</label>
          <select className="select" name="coder" defaultValue={coderId ?? ""}>
            <option value="">All coders</option>
            {coders.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn">Filter</button>
        <p className="faint text-[12px] ml-auto">
          {apps.length} annotation{apps.length === 1 ? "" : "s"} on {unitIds.length} post
          {unitIds.length === 1 ? "" : "s"} by {nCoders} coder{nCoders === 1 ? "" : "s"}
          {!isLead && " · open rounds show only your own coding"}
        </p>
      </form>

      <div className="grid md:grid-cols-[1fr_240px] gap-4 items-start">
        <ol className="space-y-3 min-w-0">
          {shownIds.map((uid) => {
            const unit = unitById.get(uid);
            if (!unit) return null;
            const list = byUnit.get(uid)!;
            const segments = buildSegments(
              unit.text,
              list.map((a) => ({ code_id: a.coder_id, start_offset: a.start_offset, end_offset: a.end_offset })),
            );
            const whole = list.filter((a) => a.start_offset === null);
            const url = linkKey ? unit.meta?.[linkKey] : undefined;
            const others = othersOnUnit.get(uid) ?? [];
            return (
              <li key={uid} className="panel p-4">
                <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[12px]">
                  <span className="faint num">{unit.external_id}</span>
                  {displayKeys
                    .filter((k) => unit.meta?.[k])
                    .map((k) => (
                      <span key={k} className="chip">
                        <span className="faint">{k}</span> {unit.meta[k]}
                      </span>
                    ))}
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="ml-auto">
                      original ↗
                    </a>
                  )}
                </div>
                {unit.context?.length > 0 && (
                  <details className="mb-2">
                    <summary className="faint text-[12px] cursor-pointer">
                      Context ({unit.context.map((c) => c.label).join(", ")})
                    </summary>
                    {unit.context.map((c, i) => (
                      <blockquote key={i} className="muted text-[12px] border-l-2 pl-2 mt-1.5 whitespace-pre-wrap" style={{ borderColor: "var(--border-strong)" }}>
                        <span className="label">{c.label}</span>
                        {c.text}
                      </blockquote>
                    ))}
                  </details>
                )}
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                  {segments.map((s, i) =>
                    s.codeIds.length === 0 ? (
                      <span key={i}>{s.text}</span>
                    ) : (
                      <mark
                        key={i}
                        title={`${new Set(s.codeIds).size} coder(s)`}
                        style={{
                          background: `color-mix(in srgb, ${code.color} ${Math.min(55, 12 + 14 * new Set(s.codeIds).size)}%, transparent)`,
                          color: "inherit",
                          borderRadius: 2,
                        }}
                      >
                        {s.text}
                      </mark>
                    ),
                  )}
                </p>
                <ul className="mt-2 space-y-1 text-[12px]">
                  {list.map((a) => (
                    <li key={a.id} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{a.coder_name}</span>
                      <span className="faint">R{a.round_number}</span>
                      <span className="faint">{a.start_offset === null ? "whole post" : "span"}</span>
                      {a.original_code_id && a.original_code_id !== codeId && (
                        <span className="faint">originally “{a.original_name}”</span>
                      )}
                      {a.code_id !== codeId && a.original_code_id === codeId && (
                        <span className="faint">now “{code.merged_into_name}”</span>
                      )}
                      {a.memo && <span className="muted italic">— {a.memo}</span>}
                    </li>
                  ))}
                </ul>
                {whole.length > 0 && segments.every((s) => s.codeIds.length === 0) && (
                  <p className="faint text-[12px] mt-1">Applied to the whole post.</p>
                )}
                {others.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-2 text-[12px]">
                    <span className="faint">Also coded</span>
                    {others.map((o) => (
                      <Link key={o.id} href={`${base}/${o.id}`} className="chip" style={{ borderColor: o.color }}>
                        {o.name}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {unitIds.length === 0 && (
            <li className="panel px-4 py-8 text-center muted text-[13px]">
              No posts {roundId || coderId ? "match these filters" : "have been coded with this code yet"}.
            </li>
          )}
          {unitIds.length > shownIds.length && (
            <li className="text-center">
              <Link className="btn" href={filterHref({ limit: String(limit + PAGE * 2) })}>
                Show more ({unitIds.length - shownIds.length} remaining)
              </Link>
            </li>
          )}
        </ol>

        <aside className="panel p-3 md:sticky md:top-4">
          <h2 className="text-[13px] font-semibold mb-1">Often coded alongside</h2>
          <p className="faint text-[12px] mb-2">
            Posts where the same coder also applied another code. A pair that nearly always
            travels together may be one code.
          </p>
          {related.length === 0 ? (
            <p className="faint text-[12px]">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {related.map((r) => (
                <li key={r.id} className="text-[12px] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
                  <Link href={`${base}/${r.id}`} className="truncate">
                    {r.name}
                  </Link>
                  <span className="faint num ml-auto shrink-0">
                    {r.posts}/{unitIds.length}
                  </span>
                  {!code.merged_into && (
                    <Link
                      href={`${base}/merges?codes=${liveId},${r.id}`}
                      className="faint shrink-0"
                      title={`Propose merging ${code.name} and ${r.name}`}
                    >
                      merge…
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
