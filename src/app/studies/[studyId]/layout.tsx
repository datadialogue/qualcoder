import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { getStudy } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { StudyNav } from "@/components/StudyNav";

export default async function StudyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  const study = await getStudy(studyId);
  if (!study) notFound();

  return (
    <>
      <StudyNav
        studyId={study.id}
        name={study.name}
        archived={study.status === "archived"}
        isLead={coder.role === "lead"}
      />
      {children}
    </>
  );
}
