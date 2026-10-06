import { cookies } from "next/headers";

import { deleteEmployeeSession, SESSION_COOKIE } from "@/lib/auth";
import { rejectUnsafeRequest } from "@/lib/auth-security";

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request);
  if (rejected) return rejected;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await deleteEmployeeSession(token);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  return response;
}
