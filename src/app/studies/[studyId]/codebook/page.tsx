import { currentCoder } from "@/lib/auth";
import { getCodebook } from "@/lib/queries";
import { sql } from "@/lib/db";
import { SignedOut } from "@/components/SignedOut";
import { ActionForm } from "@/components/ActionForm";
import {
  confirmCode,
  createCode,
  createTheme,
  deleteCode,
  deleteTheme,
  importCodebook,
  setCodeArchived,
  updateCode,
  updateTheme,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function CodebookPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;

  const isLead = coder.role === "lead";
  const [themes, archived, usage, authors] = await Promise.all([
    getCodebook(studyId),
    sql<{ id: string; name: string }[]>`
      SELECT id, name FROM codes WHERE study_id = ${studyId} AND archived = true ORDER BY name
    `,
    sql<{ code_id: string; n: number }[]>`
      SELECT a.code_id, count(*)::int AS n
      FROM annotations a JOIN codes c ON c.id = a.code_id
      WHERE c.study_id = ${studyId}
      GROUP BY a.code_id
    `,
    sql<{ id: string; name: string }[]>`
      SELECT c.id, co.name FROM codes c JOIN coders co ON co.id = c.created_by
      WHERE c.study_id = ${studyId}
    `,
  ]);
  const useCount = new Map(usage.map((u) => [u.code_id, u.n]));
  const authorOf = new Map(authors.map((a) => [a.id, a.name]));
  const provisional = themes.flatMap((t) => t.codes).filter((c) => c.provisional);
  const allThemes = themes.filter((t) => t.id !== "__unfiled__");
  const totalCodes = themes.reduce((n, t) => n + t.codes.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Codebook</h1>
        <p className="muted text-[13px] mt-1 max-w-2xl">
          {totalCodes} active code{totalCodes === 1 ? "" : "s"} across {allThemes.length} theme
          {allThemes.length === 1 ? "" : "s"}. Codes stay editable between rounds; each round
          stores a snapshot of the codebook as it stood when the round closed.
        </p>
      </header>

      {!isLead && (
        <p className="panel px-3 py-2 text-[13px] muted mb-6">
          You are signed in as a coder, so the codebook is read-only here.
        </p>
      )}

      {isLead && provisional.length > 0 && (
        <section className="panel p-4 mb-6" style={{ borderColor: "var(--warn)" }}>
          <h2 className="text-[13px] font-semibold mb-1">
            {provisional.length} code{provisional.length === 1 ? "" : "s"} added while coding
          </h2>
          <p className="muted text-[13px] mb-3 max-w-2xl">
            Coders can add a code when none of the existing ones fit. Review these before the next
            round: give them a definition, file them under a theme, merge duplicates, then keep or
            archive each one.
          </p>
          <ul className="flex flex-wrap gap-2">
            {provisional.map((c) => (
              <li key={c.id} className="chip" style={{ borderColor: c.color }}>
                <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                {c.name}
                {c.created_by && (
                  <span className="faint">by {authorOf.get(c.id) ?? "unknown"}</span>
                )}
                <span className="faint">· {useCount.get(c.id) ?? 0} uses</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLead && totalCodes === 0 && (
        <section className="panel p-4 mb-6" style={{ borderColor: "var(--accent)" }}>
          <h2 className="text-[13px] font-semibold mb-1">Start by pasting your existing codes</h2>
          <p className="muted text-[13px] mb-3">
            One code per line as <code>theme, code, definition</code> — tab-separated works too, so
            you can paste straight from a spreadsheet. A header row is detected automatically (and
            picks up <code>inclusion</code>, <code>exclusion</code> and <code>example</code> columns),
            a single column is read as a bare list of codes, and JSON is accepted as well.
          </p>
          <ImportForm studyId={studyId} />
        </section>
      )}

      <div className="space-y-4">
        {themes.map((theme) => (
          <section key={theme.id} className="panel overflow-hidden">
            <div
              className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: theme.color }}
              />
              <h2 className="text-[13px] font-semibold">{theme.name}</h2>
              <span className="chip num">{theme.codes.length}</span>
              {theme.description && (
                <span className="muted text-[12px] truncate">{theme.description}</span>
              )}
              {isLead && theme.id !== "__unfiled__" && (
                <details className="ml-auto relative shrink-0">
                  <summary className="btn text-[12px] py-0.5 list-none cursor-pointer">
                    Edit theme
                  </summary>
                  <div className="panel absolute right-0 top-8 z-20 p-3 w-80 shadow-lg space-y-2">
                    <ActionForm action={updateTheme} className="space-y-2" submitLabel="Save theme">
                      <input type="hidden" name="study_id" value={studyId} />
                      <input type="hidden" name="id" value={theme.id} />
                      <div>
                        <label className="label">Name</label>
                        <input className="input" name="name" defaultValue={theme.name} />
                      </div>
                      <div>
                        <label className="label">Description</label>
                        <textarea
                          className="textarea"
                          name="description"
                          rows={2}
                          defaultValue={theme.description}
                        />
                      </div>
                      <div>
                        <label className="label">Colour</label>
                        <input
                          className="input h-8"
                          type="color"
                          name="color"
                          defaultValue={theme.color}
                        />
                      </div>
                    </ActionForm>
                    <ActionForm
                      action={deleteTheme}
                      submitLabel="Delete theme"
                      submitClassName="btn btn-danger w-full justify-center text-[12px]"
                      confirm={`Delete the theme "${theme.name}"? Its codes move to Unfiled and keep all their coding.`}
                    >
                      <input type="hidden" name="study_id" value={studyId} />
                      <input type="hidden" name="id" value={theme.id} />
                    </ActionForm>
                  </div>
                </details>
              )}
            </div>

            <ul>
              {theme.codes.map((code) => {
                const used = useCount.get(code.id) ?? 0;
                return (
                  <li
                    key={code.id}
                    className="border-b last:border-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <details>
                      <summary className="flex items-center gap-2.5 px-4 py-2 cursor-pointer list-none">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ background: code.color }}
                        />
                        <span className="text-[13px] font-medium shrink-0">{code.name}</span>
                        {code.provisional && (
                          <span
                            className="chip shrink-0"
                            style={{ background: "var(--warn-soft)", color: "var(--warn)", borderColor: "transparent" }}
                            title={
                              code.created_by
                                ? `Added while coding by ${authorOf.get(code.id) ?? "a coder"}`
                                : "Added while coding"
                            }
                          >
                            new
                          </span>
                        )}
                        <span className="muted text-[12px] truncate flex-1">
                          {code.definition || <em className="faint">no definition yet</em>}
                        </span>
                        <span className="chip num shrink-0">{used} uses</span>
                      </summary>

                      {isLead ? (
                        <div className="px-4 pb-4 pt-1">
                          <ActionForm
                            action={updateCode}
                            className="grid grid-cols-2 gap-3"
                            submitLabel="Save code"
                            submitClassName="btn btn-primary col-span-2 w-fit"
                          >
                            <input type="hidden" name="study_id" value={studyId} />
                            <input type="hidden" name="id" value={code.id} />
                            <div className="col-span-2 grid grid-cols-[1fr_180px_64px] gap-2">
                              <div>
                                <label className="label">Name</label>
                                <input className="input" name="name" defaultValue={code.name} />
                              </div>
                              <div>
                                <label className="label">Theme</label>
                                <select
                                  className="select"
                                  name="theme_id"
                                  defaultValue={code.theme_id ?? ""}
                                >
                                  <option value="">Unfiled</option>
                                  {allThemes.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="label">Colour</label>
                                <input
                                  className="input h-[30px] p-0.5"
                                  type="color"
                                  name="color"
                                  defaultValue={code.color}
                                />
                              </div>
                            </div>
                            <div className="col-span-2">
                              <label className="label">Definition</label>
                              <textarea
                                className="textarea"
                                name="definition"
                                rows={2}
                                defaultValue={code.definition}
                              />
                            </div>
                            <div>
                              <label className="label">Apply when</label>
                              <textarea
                                className="textarea"
                                name="inclusion"
                                rows={2}
                                defaultValue={code.inclusion}
                              />
                            </div>
                            <div>
                              <label className="label">Do not apply when</label>
                              <textarea
                                className="textarea"
                                name="exclusion"
                                rows={2}
                                defaultValue={code.exclusion}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="label">Example</label>
                              <textarea
                                className="textarea"
                                name="example"
                                rows={2}
                                defaultValue={code.example}
                              />
                            </div>
                          </ActionForm>
                          <div className="flex gap-2 mt-2">
                            {code.provisional && (
                              <ActionForm
                                action={confirmCode}
                                submitLabel="Keep in codebook"
                                submitClassName="btn btn-primary text-[12px]"
                              >
                                <input type="hidden" name="study_id" value={studyId} />
                                <input type="hidden" name="id" value={code.id} />
                              </ActionForm>
                            )}
                            <ActionForm
                              action={setCodeArchived}
                              submitLabel="Archive"
                              submitClassName="btn text-[12px]"
                            >
                              <input type="hidden" name="study_id" value={studyId} />
                              <input type="hidden" name="id" value={code.id} />
                              <input type="hidden" name="archived" value="true" />
                            </ActionForm>
                            {used === 0 && (
                              <ActionForm
                                action={deleteCode}
                                submitLabel="Delete"
                                submitClassName="btn btn-danger text-[12px]"
                                confirm={`Delete the code "${code.name}"?`}
                              >
                                <input type="hidden" name="study_id" value={studyId} />
                                <input type="hidden" name="id" value={code.id} />
                              </ActionForm>
                            )}
                          </div>
                        </div>
                      ) : (
                        <dl className="px-4 pb-3 pt-1 text-[13px] space-y-1">
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
                          {code.example && (
                            <div>
                              <dt className="label inline mr-1">Example</dt>
                              <dd className="inline muted italic">{code.example}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </details>
                  </li>
                );
              })}
              {theme.codes.length === 0 && (
                <li className="px-4 py-3 faint text-[13px]">No codes in this theme yet.</li>
              )}
            </ul>
          </section>
        ))}
      </div>

      {isLead && (
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <section className="panel p-4">
            <h2 className="text-[13px] font-semibold mb-2">Add a code</h2>
            <ActionForm action={createCode} className="space-y-2" submitLabel="Add code">
              <input type="hidden" name="study_id" value={studyId} />
              <div>
                <label className="label">Name</label>
                <input className="input" name="name" placeholder="Sarcasm" />
              </div>
              <div>
                <label className="label">Theme</label>
                <select className="select" name="theme_id" defaultValue="">
                  <option value="">Unfiled</option>
                  {allThemes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Definition</label>
                <textarea className="textarea" name="definition" rows={2} />
              </div>
            </ActionForm>
          </section>

          <section className="panel p-4">
            <h2 className="text-[13px] font-semibold mb-2">Add a theme</h2>
            <ActionForm action={createTheme} className="space-y-2" submitLabel="Add theme">
              <input type="hidden" name="study_id" value={studyId} />
              <div>
                <label className="label">Name</label>
                <input className="input" name="name" placeholder="Tone" />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="textarea" name="description" rows={2} />
              </div>
            </ActionForm>

            {totalCodes > 0 && (
              <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-[13px] font-semibold mb-2">Bulk import</h2>
                <ImportForm studyId={studyId} />
              </div>
            )}
          </section>
        </div>
      )}

      {isLead && archived.length > 0 && (
        <section className="panel p-4 mt-4">
          <h2 className="text-[13px] font-semibold mb-2">Archived codes</h2>
          <p className="muted text-[12px] mb-2">
            Hidden from the coding palette. Existing annotations that use them are untouched and
            still appear in exports and analysis.
          </p>
          <ul className="flex flex-wrap gap-2">
            {archived.map((c) => (
              <li key={c.id}>
                <ActionForm
                  action={setCodeArchived}
                  submitLabel={`${c.name} — restore`}
                  submitClassName="btn text-[12px]"
                >
                  <input type="hidden" name="study_id" value={studyId} />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="archived" value="false" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ImportForm({ studyId }: { studyId: string }) {
  return (
    <ActionForm action={importCodebook} className="space-y-2" submitLabel="Import codes">
      <input type="hidden" name="study_id" value={studyId} />
      <textarea
        className="textarea font-mono text-[12px]"
        name="text"
        rows={6}
        placeholder={
          "theme,code,definition\n" +
          "Tone,Sarcasm,Says the opposite of what is meant for effect\n" +
          "Tone,Hostility,Attacks or belittles another person\n" +
          "Stance,Agrees with the post,Explicitly endorses the original post's claim"
        }
      />
    </ActionForm>
  );
}
