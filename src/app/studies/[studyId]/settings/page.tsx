import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getMetaKeys, getStudy } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { ActionForm } from "@/components/ActionForm";
import { LeadOnly } from "@/components/Progress";
import { StarterImport } from "@/components/StarterImport";
import { deleteStudy, setStudyStatus, updateDisplay, updateStudy } from "./actions";

export const dynamic = "force-dynamic";

export default async function StudySettingsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  const base = `/studies/${studyId}`;
  if (coder.role !== "lead") {
    return <LeadOnly what="Study settings are restricted to leads." href={base} label="Back to the study" />;
  }
  const study = await getStudy(studyId);
  if (!study) notFound();

  const [metaKeys, [counts]] = await Promise.all([
    getMetaKeys(studyId),
    sql<{ units: number; annotations: number; rounds: number }[]>`
      SELECT (SELECT count(*)::int FROM units WHERE study_id = ${studyId}) AS units,
             (SELECT count(*)::int FROM annotations a JOIN rounds r ON r.id = a.round_id
               WHERE r.study_id = ${studyId}) AS annotations,
             (SELECT count(*)::int FROM rounds WHERE study_id = ${studyId}) AS rounds
    `,
  ]);
  const display = new Set(study.settings.displayKeys ?? []);
  const hidden = <input type="hidden" name="study_id" value={studyId} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-4">
      <header className="mb-2">
        <h1 className="text-xl font-semibold tracking-tight">Data &amp; settings</h1>
        <p className="muted text-[13px] mt-1 num">
          {counts.units.toLocaleString()} units · {counts.rounds} rounds ·{" "}
          {counts.annotations.toLocaleString()} annotations
        </p>
      </header>

      <section className="panel p-4">
        <h2 className="text-[13px] font-semibold mb-1">Import data</h2>
        <p className="muted text-[12px] mb-3 max-w-2xl">
          Adds units to this study. Units are matched on their id, so re-importing a corrected or
          extended file updates existing units in place and leaves their coding attached. Units
          already in a round are not removed by a new import.
        </p>
        <StarterImport mode="append" studyId={studyId} initialMapping={study.settings.mapping} />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="panel p-4">
          <h2 className="text-[13px] font-semibold mb-2">Study</h2>
          <ActionForm action={updateStudy} className="space-y-2" submitLabel="Save">
            {hidden}
            <div>
              <label className="label">Name</label>
              <input className="input" name="name" defaultValue={study.name} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="textarea" name="description" rows={3} defaultValue={study.description} />
            </div>
          </ActionForm>
        </section>

        <section className="panel p-4">
          <h2 className="text-[13px] font-semibold mb-1">While coding</h2>
          <p className="muted text-[12px] mb-3">
            Metadata shown as chips above each unit. Keep it to what helps interpret the text.
          </p>
          {metaKeys.length === 0 ? (
            <p className="faint text-[12px]">No metadata yet — import data first.</p>
          ) : (
            <ActionForm action={updateDisplay} className="space-y-3" submitLabel="Save">
              {hidden}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {metaKeys.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-[13px]">
                    <input type="checkbox" name="display_keys" value={k} defaultChecked={display.has(k)} />
                    {k}
                  </label>
                ))}
              </div>
              <div>
                <label className="label">Link to the original item</label>
                <select className="select" name="link_key" defaultValue={study.settings.linkKey ?? ""}>
                  <option value="">None</option>
                  {metaKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </ActionForm>
          )}
        </section>
      </div>

      <section className="panel p-4 grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-[13px] font-semibold mb-1">
            {study.status === "archived" ? "Restore study" : "Archive study"}
          </h2>
          <p className="muted text-[12px] mb-2">
            Archiving hides the study from the home page and coders&rsquo; work lists. Nothing is
            deleted, and it can be restored at any time.
          </p>
          <ActionForm
            action={setStudyStatus}
            submitLabel={study.status === "archived" ? "Restore" : "Archive"}
            submitClassName="btn"
          >
            {hidden}
            <input type="hidden" name="status" value={study.status === "archived" ? "active" : "archived"} />
          </ActionForm>
        </div>
        <div>
          <h2 className="text-[13px] font-semibold mb-1">Delete study</h2>
          <p className="muted text-[12px] mb-2">
            Permanently removes every unit, code, round and annotation in this study. Export it
            first. Type the study&rsquo;s name to confirm.
          </p>
          <ActionForm
            action={deleteStudy}
            className="space-y-2"
            submitLabel="Delete study"
            submitClassName="btn btn-danger"
            confirm="Delete this study and all of its coding? This cannot be undone."
          >
            {hidden}
            <input className="input" name="confirm" placeholder={study.name} autoComplete="off" />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
