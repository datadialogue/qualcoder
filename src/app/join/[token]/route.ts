import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, sealSession } from "@/lib/auth";

/**
 * Invite links bind a browser to a coder identity. The token is a bearer
 * credential, so it is exchanged for a signed cookie and never kept in the URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM coders WHERE token = ${token} AND active = true
  `;
  if (rows.length === 0) {
    redirect("/?error=invalid-invite");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(rows[0].id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect("/");
}
