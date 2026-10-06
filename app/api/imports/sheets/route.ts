import { rejectUnsafeRequest } from "@/lib/auth-security";
import { importAccess, importSheet } from "@/lib/sheet-import";
import { rosterSyncSources } from "@/lib/roster-sources";
import { attendanceSyncSources } from "@/lib/attendance-sources";

// A running member script gets the reviewed sources from the app, so adding a
// branch does not require another token or a new hardcoded list in Google.
export async function GET(request: Request) {
  const access = await importAccess(request);
  if (!access) return Response.json({error:"Conexión no autorizada o vencida."},{status:401});
  if (access === "attendance" && new URL(request.url).searchParams.get("kind") === "attendance") return Response.json({sources:attendanceSyncSources()},{headers:{"Cache-Control":"no-store"}});
  if (access !== "members") return Response.json({error:"Esta conexión no permite consultar padrones."},{status:403});
  return Response.json({sources:rosterSyncSources()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
  try {
    const access = await importAccess(request);
    if (!access) return Response.json({ error: "Conexión no autorizada o vencida." }, { status: 401 });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Faltan los datos." }, { status: 400 });
    let bytes = 0; let raw = ""; const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 2_000_000) { await reader.cancel(); return Response.json({ error: "La planilla excede el tamaño permitido." }, { status: 413 }); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Formato inválido." }, { status: 400 });
    return Response.json(await importSheet(body as Record<string, unknown>, access));
  } catch (error) {
    // Only explicitly recognized validation messages are safe to return.
    const message = error instanceof Error ? error.message : "";
    if (/^(Formato|Falta el encabezado|La estructura|Identificación|Esta conexión|Padrón no|Planilla de|Período|Los días|Hay una asistencia|No se pueden|Tipo de)/.test(message)) return Response.json({ error: message }, { status: 400 });
    console.error("sheet_import_failed");
    return Response.json({ error: "No se pudo guardar la importación. Podés volver a enviarla sin duplicar registros." }, { status: 500 });
  }
}
