import { and, count, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { employees, sessions } from "@/db/schema";
import { roleLabels, normalizeRole, employeeScope, type EmployeeRole } from "@/lib/permissions";
import { derivePasswordHash, PASSWORD_ITERATIONS } from "@/lib/password-hash";

export { PASSWORD_ITERATIONS } from "@/lib/password-hash";

export const SESSION_COOKIE = "vukova_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type CurrentEmployee = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: EmployeeRole;
  roleLabel: string;
  branchScope: string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createPasswordRecord(password: string) {
  const salt = randomBytes(16);
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return {
    passwordHash: bytesToBase64Url(hash),
    passwordSalt: bytesToBase64Url(salt),
    passwordIterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(password: string, encodedHash: string, encodedSalt: string, iterations: number) {
  const expected = base64UrlToBytes(encodedHash);
  const actual = await derivePasswordHash(password, base64UrlToBytes(encodedSalt), iterations);
  return timingSafeEqual(actual, expected);
}

export async function hasEmployees() {
  const db = getDb();
  const [result] = await db.select({ value: count() }).from(employees);
  return Number(result?.value ?? 0) > 0;
}

export async function createEmployeeSession(employeeId: string) {
  const token = bytesToBase64Url(randomBytes(32));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const db = getDb();
  await db.insert(sessions).values({
    id: bytesToBase64Url(randomBytes(16)),
    employeeId,
    tokenHash: await hashToken(token),
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return { token, expiresAt };
}

export async function deleteEmployeeSession(token: string) {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
}

export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = new Date().toISOString();
  const db = getDb();
  const [row] = await db
    .select({
      id: employees.id,
      username: employees.username,
      displayName: employees.displayName,
      email: employees.email,
      role: employees.role,
      branchScope: employees.branchScope,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(employees, eq(sessions.employeeId, employees.id))
    .where(and(eq(sessions.tokenHash, await hashToken(token)), gt(sessions.expiresAt, now), eq(employees.active, true)))
    .limit(1);

  if (!row) return null;
  const role = normalizeRole(row.role);
  if (!role) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role,
    roleLabel: roleLabels[role],
    branchScope: employeeScope(role, row.branchScope),
  };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isUniqueConstraintError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

export function authErrorMessage(error: unknown, stage = "auth") {
  const message = error instanceof Error ? error.message : "Error inesperado";
  const category = /Pbkdf2|PBKDF2/.test(message) ? "password_hash" : /D1|SQLITE|no such table/i.test(message) ? "database" : "unexpected";
  // Database errors may contain query parameters. Never log the raw error.
  console.error("auth.operation_failed", { stage, category });
  if (message.includes("no such table") || message.includes("D1 binding")) {
    return "La base de datos todavía no está disponible. Publicá la versión inicial y volvé a intentar.";
  }
  return "No se pudo completar la operación. Intentá nuevamente.";
}
