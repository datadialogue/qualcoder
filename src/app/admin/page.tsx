import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCoders } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { ActionForm } from "@/components/ActionForm";
import { CopyLink } from "@/components/CopyLink";
import { createCoder, regenerateToken, setCoderActive, setCoderRole } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  if (coder.role !== "lead") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="panel p-6 text-[13px] muted">
          Admin is restricted to the project lead. <Link href="/">Back to overview</Link>
        </p>
      </div>
    );
  }

  const [coders, [counts]] = await Promise.all([
    getCoders(false),
    sql<{ studies: number; units: number; annotations: number }[]>`
      SELECT (SELECT count(*)::int FROM studies) AS studies,
             (SELECT count(*)::int FROM units) AS units,
             (SELECT count(*)::int FROM annotations) AS annotations
    `,
  ]);

  const workload = await sql<{ coder_id: string; n: number }[]>`
    SELECT coder_id, count(*)::int AS n FROM annotations GROUP BY coder_id
  `;
  const byCoder = new Map(workload.map((w) => [w.coder_id, w.n]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="muted text-[13px] mt-1 num">
          {counts.studies} stud{counts.studies === 1 ? "y" : "ies"} · {counts.units.toLocaleString()}{" "}
          units · {counts.annotations.toLocaleString()} annotations
        </p>
      </header>

      <section className="panel overflow-hidden mb-4">
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[13px] font-semibold">Coders</h2>
          <p className="faint text-[12px]">
            Each person gets a unique link that identifies them. Treat it like a password: anyone
            holding it codes as that person.
          </p>
        </div>
        <ul>
          {coders.map((c) => (
            <li
              key={c.id}
              className="px-4 py-2.5 border-b last:border-0 flex flex-wrap items-center gap-2"
              style={{ borderColor: "var(--border)", opacity: c.active ? 1 : 0.55 }}
            >
              <span className="text-[13px] font-medium w-40 truncate">{c.name}</span>
              <span className="chip">{c.role}</span>
              {!c.active && <span className="chip">inactive</span>}
              <span className="faint text-[12px] num">{byCoder.get(c.id) ?? 0} annotations</span>
              <div className="ml-auto flex items-center gap-2">
                {c.active && <CopyLink path={`/join/${c.token}`} />}
                <details className="relative">
                  <summary className="btn text-[11px] py-0.5 list-none cursor-pointer">More</summary>
                  <div className="panel absolute right-0 top-7 z-20 p-2 w-56 shadow-lg space-y-1.5">
                    <ActionForm
                      action={regenerateToken}
                      submitLabel="Issue a new link"
                      submitClassName="btn text-[11px] w-full justify-center"
                      confirm="Issue a new invite link? The current one stops working immediately."
                    >
                      <input type="hidden" name="id" value={c.id} />
                    </ActionForm>
                    <ActionForm
                      action={setCoderRole}
                      submitLabel={c.role === "lead" ? "Demote to coder" : "Promote to lead"}
                      submitClassName="btn text-[11px] w-full justify-center"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="role" value={c.role === "lead" ? "coder" : "lead"} />
                    </ActionForm>
                    <ActionForm
                      action={setCoderActive}
                      submitLabel={c.active ? "Deactivate" : "Reactivate"}
                      submitClassName="btn text-[11px] w-full justify-center"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                    </ActionForm>
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="panel p-4">
          <h2 className="text-[13px] font-semibold mb-2">Add a coder</h2>
          <ActionForm action={createCoder} className="space-y-2" submitLabel="Create and issue link">
            <div>
              <label className="label">Name</label>
              <input className="input" name="name" placeholder="Ana Rivera" />
            </div>
            <div>
              <label className="label">Email (optional)</label>
              <input className="input" name="email" type="email" />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="select" name="role" defaultValue="coder">
                <option value="coder">Coder</option>
                <option value="lead">Lead — can manage studies, rounds, codebooks and adjudication</option>
              </select>
            </div>
          </ActionForm>
        </section>

        <section className="panel p-4">
          <h2 className="text-[13px] font-semibold mb-1">Studies and data</h2>
          <p className="muted text-[12px] mb-3">
            Each study has its own data, codebook and rounds. Start one from a starter file, or add
            data to an existing study from its <em>Data &amp; settings</em> page.
          </p>
          <Link href="/studies/new" className="btn btn-primary">
            New study
          </Link>
        </section>
      </div>
    </div>
  );
}
