import type { Metadata } from "next";
import "./globals.css";
import { currentCoder } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Qualitative Coding",
  description: "Shared sampling, span-level coding and inter-rater reliability.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let coder = null;
  try {
    coder = await currentCoder();
  } catch {
    // Missing env or unmigrated database: pages render their own guidance.
  }
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav coder={coder ? { name: coder.name, role: coder.role } : null} />
        <main>{children}</main>
      </body>
    </html>
  );
}
