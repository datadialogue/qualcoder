import { currentCoder } from "@/lib/auth";
import { SignedOut } from "@/components/SignedOut";
import { LeadOnly } from "@/components/Progress";
import { StarterImport } from "@/components/StarterImport";

export const dynamic = "force-dynamic";

export default async function NewStudyPage() {
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  if (coder.role !== "lead") {
    return <LeadOnly what="Only a lead can start a study." href="/" label="Back to studies" />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">New study</h1>
        <p className="muted text-[13px] mt-1 max-w-2xl">
          A study is one dataset with its own codebook, rounds and reliability figures. Start from a
          file of the items to be coded; the file is read in your browser and uploaded in batches,
          so large exports are fine.
        </p>
      </header>
      <StarterImport mode="create" />
    </div>
  );
}
