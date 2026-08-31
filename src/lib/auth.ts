import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "./db";
import type { Coder } from "./types";

export const SESSION_COOKIE = "qc_session";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set. See .env.example.");
  return s;
}

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Cookie payload is `<coderId>.<hmac>` so a tampered id is rejected. */
export function sealSession(coderId: string): string {
  return `${coderId}.${sign(coderId)}`;
}

export function unsealSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/** The signed-in coder, or null. Safe to call from any server component. */
export async function currentCoder(): Promise<Coder | null> {
  const jar = await cookies();
  const id = unsealSession(jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const rows = await sql<Coder[]>`
    SELECT id, name, email, token, role, active, created_at
    FROM coders WHERE id = ${id} AND active = true
  `;
  return rows[0] ?? null;
}


/** JSON API guard: returns the coder, or a Response to return directly. */
export async function coderOrUnauthorized(): Promise<
  { coder: Coder; response?: never } | { coder?: never; response: Response }
> {
  const coder = await currentCoder();
  if (!coder) {
    return {
      response: Response.json(
        { error: "Not signed in. Open your invite link to continue." },
        { status: 401 },
      ),
    };
  }
  return { coder };
}

/**
 * Guard for server actions. Returns null when the caller may proceed, or an
 * error result to hand straight back to the form.
 *
 * The lead-only forms are already hidden from coders, so reaching this is
 * either a stale page or someone poking at the endpoint; either way a message
 * beats an unhandled exception.
 */
export async function leadGuard(): Promise<{ error: string } | null> {
  const coder = await currentCoder();
  if (!coder) return { error: "Not signed in. Open your invite link to continue." };
  if (coder.role !== "lead") {
    return { error: "That action is restricted to the project lead." };
  }
  return null;
}
