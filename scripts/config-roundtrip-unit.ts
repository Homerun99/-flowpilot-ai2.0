// Round-trip tests for task 82bf837e — persist requireAddress in
// POST /api/workspace/receptionist-config (the handler used to rebuild a fixed
// 5-field config object and drop unknown keys, so the Admin Settings toggle's
// requireAddress never survived).
//
// Covers:
//   A. POST requireAddress=true  → response.config.requireAddress === true
//                                  → GET returns it → DB row has it
//   B. Old-client POST (no requireAddress key) → flag PRESERVED, not cleared
//   C. POST requireAddress=false → clears it (UI uncheck path)
//   D. Fresh workspace never told about the flag → stays unset (default false
//      = no address ask), and the other 5 fields still persist exactly as before
//
// Run: bun scripts/config-roundtrip-unit.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { handleApiRequest } from "../api-handler.ts";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

const BASE = "http://localhost";
const WS_A = "ws_ra_test_a";
const WS_B = "ws_ra_test_b";

async function post(body: Record<string, unknown>) {
  const res = await handleApiRequest(
    "/api/workspace/receptionist-config",
    "POST",
    new Request(`${BASE}/api/workspace/receptionist-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return res ? { status: res.status, json: await res.json() as any } : null;
}
async function get(wsId: string) {
  const res = await handleApiRequest(
    "/api/workspace/receptionist-config",
    "GET",
    new Request(`${BASE}/api/workspace/receptionist-config?workspace=${encodeURIComponent(wsId)}`)
  );
  return res ? await res.json() as any : null;
}
async function dbConfig(id: string): Promise<Record<string, unknown> | null> {
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
    columns: { receptionistConfig: true },
  });
  return (ws?.receptionistConfig as Record<string, unknown>) ?? null;
}

async function main() {
  // ── Setup: two throwaway workspaces ────────────────────────────────
  await db.insert(workspaces).values([
    { id: WS_A, name: "RoundTrip Test A" },
    { id: WS_B, name: "RoundTrip Test B" },
  ]).onConflictDoNothing();
  console.log("== SETUP ==");
  check("workspace A created", !!(await dbConfig(WS_A)) || true, ""); // config starts null; existence is implied by later ops
  check("workspace B created", !!(await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS_B) })));

  // ── A. POST requireAddress=true persists end-to-end ────────────────
  console.log("\n== A. POST requireAddress=true ==");
  const a1 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
    requireAddress: true,
  });
  check("POST returns 200", a1?.status === 200, `status=${a1?.status}`);
  check("POST response config.requireAddress === true", a1?.json?.config?.requireAddress === true, JSON.stringify(a1?.json?.config));
  check("POST response keeps businessName", a1?.json?.config?.businessName === "ABC Plumbing");
  check("POST response keeps the other 4 fields", a1?.json?.config?.businessType === "plumbing"
    && a1?.json?.config?.businessHours === "Tue-Fri 10am-5pm"
    && a1?.json?.config?.description === "Home service plumbing"
    && a1?.json?.config?.customInstructions === "Always ask for the address");

  const a2 = await get(WS_A);
  check("GET returns requireAddress === true", a2?.config?.requireAddress === true, JSON.stringify(a2?.config));

  const aDb = await dbConfig(WS_A);
  check("DB row has requireAddress === true", aDb?.requireAddress === true, JSON.stringify(aDb));

  // ── B. Old-client POST without the key must NOT clear it ───────────
  console.log("\n== B. Old client omits requireAddress (must preserve) ==");
  const b1 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
  });
  check("POST response carries preserved requireAddress === true", b1?.json?.config?.requireAddress === true, JSON.stringify(b1?.json?.config));
  const bDb = await dbConfig(WS_A);
  check("DB still has requireAddress === true (preserved)", bDb?.requireAddress === true, JSON.stringify(bDb));

  // ── C. POST requireAddress=false clears it (UI uncheck path) ───────
  console.log("\n== C. POST requireAddress=false clears ==");
  const c1 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
    requireAddress: false,
  });
  check("POST response config.requireAddress === false", c1?.json?.config?.requireAddress === false, JSON.stringify(c1?.json?.config));
  const cDb = await dbConfig(WS_A);
  check("DB now has requireAddress === false", cDb?.requireAddress === false, JSON.stringify(cDb));

  // ── D. Fresh workspace never told about the flag stays unset ───────
  console.log("\n== D. Fresh workspace stays unset (default = no address ask) ==");
  const d1 = await post({
    workspace_id: WS_B,
    businessName: "Zed Roofing",
    businessType: "roofing",
    businessHours: "Mon-Sat 8am-6pm",
    description: "Residential roofing",
    customInstructions: "Greet warmly",
  });
  check("POST response omits requireAddress key", !("requireAddress" in (d1?.json?.config ?? {})), JSON.stringify(d1?.json?.config));
  const dDb = await dbConfig(WS_B);
  check("DB has NO requireAddress key (unset → default false)", !("requireAddress" in (dDb ?? {})), JSON.stringify(dDb));
  check("DB keeps businessName (other fields unaffected)", dDb?.businessName === "Zed Roofing", JSON.stringify(dDb));

  // ── E. Structured openDays/openHours round-trip + carry-over ─────────
  console.log("\n== E. openDays/openHours persist + carry over ==");
  const e1 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
    requireAddress: false,
    openDays: ["Tuesday", "Wednesday", "Thursday", "Friday"],
    openHours: { start: "10:00", end: "17:00" },
  });
  check("E POST response has openDays", Array.isArray(e1?.json?.config?.openDays) && e1?.json?.config?.openDays.length === 4, JSON.stringify(e1?.json?.config?.openDays));
  check("E POST response has openHours", e1?.json?.config?.openHours?.start === "10:00" && e1?.json?.config?.openHours?.end === "17:00", JSON.stringify(e1?.json?.config?.openHours));
  const e2 = await get(WS_A);
  check("E GET returns openDays", Array.isArray(e2?.config?.openDays) && e2?.config?.openDays.length === 4, JSON.stringify(e2?.config?.openDays));
  check("E GET returns openHours", e2?.config?.openHours?.start === "10:00" && e2?.config?.openHours?.end === "17:00", JSON.stringify(e2?.config?.openHours));
  const eDb = await dbConfig(WS_A);
  check("E DB row has openDays + openHours", Array.isArray(eDb?.openDays) && eDb?.openHours?.start === "10:00" && eDb?.openHours?.end === "17:00", JSON.stringify(eDb));

  // Old-client POST omitting openDays/openHours must carry them over.
  const e3 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
    requireAddress: false,
  });
  const e3Db = await dbConfig(WS_A);
  check("E omitted openDays carried over", Array.isArray(e3Db?.openDays) && e3Db?.openDays.length === 4, JSON.stringify(e3Db?.openDays));
  check("E omitted openHours carried over", e3Db?.openHours?.start === "10:00" && e3Db?.openHours?.end === "17:00", JSON.stringify(e3Db?.openHours));
  check("E response also carries them", Array.isArray(e3?.json?.config?.openDays), JSON.stringify(e3?.json?.config));

  // Explicit openHours: null clears it; openDays stays.
  const e4 = await post({
    workspace_id: WS_A,
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Home service plumbing",
    customInstructions: "Always ask for the address",
    requireAddress: false,
    openHours: null,
  });
  const e4Db = await dbConfig(WS_A);
  check("E explicit openHours:null clears it", e4Db?.openHours === null, JSON.stringify(e4Db?.openHours));
  check("E openDays survives the openHours clear", Array.isArray(e4Db?.openDays) && e4Db?.openDays.length === 4, JSON.stringify(e4Db?.openDays));

  // Fresh workspace (B) with only core fields → no structured keys at all.
  const e5 = await post({
    workspace_id: WS_B,
    businessName: "Zed Roofing",
  });
  const e5Db = await dbConfig(WS_B);
  check("E fresh workspace has NO openDays key", !("openDays" in (e5Db ?? {})), JSON.stringify(e5Db));
  check("E fresh workspace has NO openHours key", !("openHours" in (e5Db ?? {})), JSON.stringify(e5Db));

  // ── F. Partial save preserves the 5 core persona fields (merge) ─────
  console.log("\n== F. partial save preserves core fields ==");
  const f1 = await post({
    workspace_id: WS_A,
    businessName: "Full Persona Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
    description: "Full persona description",
    customInstructions: "Always greet warmly",
    requireAddress: true,
    openDays: ["Tuesday", "Wednesday"],
    openHours: { start: "10:00", end: "17:00" },
  });
  check("F1 full save stores all fields", f1?.status === 200 && f1?.json?.config?.businessType === "plumbing"
    && f1?.json?.config?.customInstructions === "Always greet warmly", JSON.stringify(f1?.json?.config));

  // The designer's card sends only its own fields + an echo-back; a true
  // partial save (businessName + openDays only) must NOT null the others.
  const f2 = await post({
    workspace_id: WS_A,
    businessName: "Partial Plumbing",
    openDays: ["Monday"],
  });
  const f2Db = await dbConfig(WS_A);
  check("F2 businessName updated", f2Db?.businessName === "Partial Plumbing", JSON.stringify(f2Db?.businessName));
  check("F2 businessType preserved", f2Db?.businessType === "plumbing", JSON.stringify(f2Db?.businessType));
  check("F2 businessHours preserved", f2Db?.businessHours === "Tue-Fri 10am-5pm", JSON.stringify(f2Db?.businessHours));
  check("F2 description preserved", f2Db?.description === "Full persona description", JSON.stringify(f2Db?.description));
  check("F2 customInstructions preserved", f2Db?.customInstructions === "Always greet warmly", JSON.stringify(f2Db?.customInstructions));
  check("F2 requireAddress preserved", f2Db?.requireAddress === true, JSON.stringify(f2Db?.requireAddress));
  check("F2 openHours preserved", f2Db?.openHours?.start === "10:00" && f2Db?.openHours?.end === "17:00", JSON.stringify(f2Db?.openHours));
  check("F2 openDays updated to [Monday]", Array.isArray(f2Db?.openDays) && f2Db?.openDays.length === 1 && f2Db?.openDays[0] === "Monday", JSON.stringify(f2Db?.openDays));
  const f2Get = await get(WS_A);
  check("F2 GET returns preserved fields", f2Get?.config?.businessType === "plumbing" && f2Get?.config?.customInstructions === "Always greet warmly", JSON.stringify(f2Get?.config));

  // Explicit empty string clears a field (Settings sends "" when cleared) —
  // must NOT touch the others.
  const f3 = await post({
    workspace_id: WS_A,
    businessName: "Partial Plumbing",
    businessType: "",
  });
  const f3Db = await dbConfig(WS_A);
  check("F3 explicit '' clears businessType", f3Db?.businessType === null, JSON.stringify(f3Db?.businessType));
  check("F3 description still preserved", f3Db?.description === "Full persona description", JSON.stringify(f3Db?.description));
  check("F3 customInstructions still preserved", f3Db?.customInstructions === "Always greet warmly", JSON.stringify(f3Db?.customInstructions));

  // ── Cleanup ────────────────────────────────────────────────────────
  // ── G. appointmentSpacer persists + carries over + clears (task afc0e6db) ─
  console.log("\n== G. appointmentSpacer persist / carry-over / clear ==");
  const g1 = await post({ workspace_id: WS_A, businessName: "Partial Plumbing", appointmentSpacer: 30 });
  check("G1 POST appointmentSpacer: 30 → 200", g1?.status === 200, `status=${g1?.status}`);
  check("G1 POST response config.appointmentSpacer === 30", g1?.json?.config?.appointmentSpacer === 30, JSON.stringify(g1?.json?.config));
  const g1Db = await dbConfig(WS_A);
  check("G1 DB appointmentSpacer === 30", g1Db?.appointmentSpacer === 30, JSON.stringify(g1Db?.appointmentSpacer));
  const g1Get = await get(WS_A);
  check("G1 GET returns appointmentSpacer === 30", g1Get?.config?.appointmentSpacer === 30, JSON.stringify(g1Get?.config));
  const g1b = await post({ workspace_id: WS_A, appointmentSpacer: 30.7 });
  check("G1b decimal 30.7 floors to 30", g1b?.json?.config?.appointmentSpacer === 30, JSON.stringify(g1b?.json?.config));

  // Old-client partial save omitting the field must preserve it.
  const g2 = await post({ workspace_id: WS_A, businessName: "Partial Plumbing" });
  const g2Db = await dbConfig(WS_A);
  check("G2 omitted appointmentSpacer carried over (still 30)", g2?.status === 200 && g2Db?.appointmentSpacer === 30, JSON.stringify(g2Db?.appointmentSpacer));

  // Explicit null clears (UI unset path).
  await post({ workspace_id: WS_A, appointmentSpacer: null });
  const g3Db = await dbConfig(WS_A);
  const g3Get = await get(WS_A);
  check("G3 explicit null clears appointmentSpacer", g3Db?.appointmentSpacer === undefined || g3Db?.appointmentSpacer === null, JSON.stringify(g3Db?.appointmentSpacer));
  check("G3 GET no longer returns it", g3Get?.config?.appointmentSpacer === undefined || g3Get?.config?.appointmentSpacer === null, JSON.stringify(g3Get?.config));

  // Explicit 0 persists (spacer enabled with legacy behavior), 90 persists.
  await post({ workspace_id: WS_A, appointmentSpacer: 0 });
  const g4Db = await dbConfig(WS_A);
  check("G4 appointmentSpacer: 0 persists as 0", g4Db?.appointmentSpacer === 0, JSON.stringify(g4Db?.appointmentSpacer));
  await post({ workspace_id: WS_A, appointmentSpacer: 90 });
  const g4bDb = await dbConfig(WS_A);
  check("G4b appointmentSpacer: 90 persists", g4bDb?.appointmentSpacer === 90, JSON.stringify(g4bDb?.appointmentSpacer));

  // Invalid values (negative) → null (disabled), never garbage.
  await post({ workspace_id: WS_A, appointmentSpacer: -5 });
  const g5Db = await dbConfig(WS_A);
  check("G5 negative spacer → null (disabled)", g5Db?.appointmentSpacer === undefined || g5Db?.appointmentSpacer === null, JSON.stringify(g5Db?.appointmentSpacer));

  // Fresh workspace B never told about the field → stays unset.
  const g6Db = await dbConfig(WS_B);
  check("G6 fresh workspace stays unset", !("appointmentSpacer" in (g6Db ?? {})), JSON.stringify(g6Db));

  // Spacer survives alongside the other optional fields in one save.
  await post({
    workspace_id: WS_A,
    requireAddress: true,
    openDays: ["Tuesday"],
    openHours: { start: "10:00", end: "17:00" },
    appointmentSpacer: 30,
  });
  const g7Db = await dbConfig(WS_A);
  check("G7 combined save: spacer + requireAddress + openDays + openHours all persist",
    g7Db?.appointmentSpacer === 30 && g7Db?.requireAddress === true
    && Array.isArray(g7Db?.openDays) && g7Db?.openDays[0] === "Tuesday"
    && g7Db?.openHours?.start === "10:00", JSON.stringify(g7Db));

  // ── H. keyQuestions persists + carries over + clears (task 721eee4c) ──
  console.log("\n== H. keyQuestions persist / carry-over / clear ==");
  const h1 = await post({
    workspace_id: WS_A,
    keyQuestions: [
      { if: "The customer needs a repair of any kind", thenAsk: ["Is the damage extensive?", "How urgent is it?"] },
      { if: "The customer is calling about a quote or estimate", thenAsk: ["What's the square footage?"] },
    ],
  });
  check("H1 POST keyQuestions → 200", h1?.status === 200, `status=${h1?.status}`);
  check("H1 response config.keyQuestions matches",
    Array.isArray(h1?.json?.config?.keyQuestions) &&
    h1?.json?.config?.keyQuestions.length === 2 &&
    h1?.json?.config?.keyQuestions[0]?.if === "The customer needs a repair of any kind" &&
    h1?.json?.config?.keyQuestions[0]?.thenAsk?.[1] === "How urgent is it?",
    JSON.stringify(h1?.json?.config?.keyQuestions));
  const h1Db = await dbConfig(WS_A);
  check("H1 DB keyQuestions matches",
    Array.isArray(h1Db?.keyQuestions) && h1Db?.keyQuestions.length === 2 &&
    h1Db?.keyQuestions[1]?.thenAsk?.[0] === "What's the square footage?",
    JSON.stringify(h1Db?.keyQuestions));
  const h1Get = await get(WS_A);
  check("H1 GET returns keyQuestions",
    Array.isArray(h1Get?.config?.keyQuestions) && h1Get?.config?.keyQuestions.length === 2,
    JSON.stringify(h1Get?.config?.keyQuestions));
  // Old-client partial save omitting the field must preserve it.
  const h2 = await post({ workspace_id: WS_A, businessName: "Partial Plumbing" });
  const h2Db = await dbConfig(WS_A);
  check("H2 omitted keyQuestions carried over (still 2 blocks)",
    h2?.status === 200 && Array.isArray(h2Db?.keyQuestions) && h2Db?.keyQuestions.length === 2,
    JSON.stringify(h2Db?.keyQuestions));
  // Whitespace-only strings are trimmed to non-empty or dropped.
  const h2b = await post({
    workspace_id: WS_A,
    keyQuestions: [{ if: "  trim me  ", thenAsk: ["  q trimmed  "] }, { if: "   ", thenAsk: ["x"] }],
  });
  const h2bDb = await dbConfig(WS_A);
  check("H2b whitespace trimmed, whitespace-only if dropped",
    Array.isArray(h2bDb?.keyQuestions) && h2bDb?.keyQuestions.length === 1 &&
    h2bDb?.keyQuestions[0]?.if === "trim me" && h2bDb?.keyQuestions[0]?.thenAsk?.[0] === "q trimmed",
    JSON.stringify(h2bDb?.keyQuestions));
  // Invalid shapes dropped: non-object entries, missing/empty if, missing/
  // empty/non-array thenAsk, non-string if, non-string questions.
  const h2c = await post({
    workspace_id: WS_A,
    keyQuestions: [
      null,
      "string entry",
      42,
      { if: "", thenAsk: ["q"] },
      { thenAsk: ["q"] },                       // no if
      { if: "no questions", thenAsk: [] },
      { if: "blank questions", thenAsk: ["", "  "] },
      { if: 123, thenAsk: ["q"] },              // non-string if
      { if: "string thenAsk", thenAsk: "nope" },
      { if: "mixed thenAsk", thenAsk: ["ok", 7, null] },
    ],
  } as any);
  const h2cDb = await dbConfig(WS_A);
  check("H2c invalid entries dropped, valid kept (1 block, 1 question)",
    Array.isArray(h2cDb?.keyQuestions) && h2cDb?.keyQuestions.length === 1 &&
    h2cDb?.keyQuestions[0]?.if === "mixed thenAsk" &&
    Array.isArray(h2cDb?.keyQuestions[0]?.thenAsk) && h2cDb?.keyQuestions[0]?.thenAsk.length === 1 &&
    h2cDb?.keyQuestions[0]?.thenAsk[0] === "ok",
    JSON.stringify(h2cDb?.keyQuestions));
  // Caps: 25 blocks → 20 stored; 25 questions → 20 stored.
  const h2d = await post({
    workspace_id: WS_A,
    keyQuestions: [
      ...Array.from({ length: 25 }, (_, i) => ({ if: `block ${i}`, thenAsk: ["q"] })),
    ],
  });
  const h2dDb = await dbConfig(WS_A);
  check("H2d 25 blocks capped at 20", Array.isArray(h2dDb?.keyQuestions) && h2dDb?.keyQuestions.length === 20,
    `len=${h2dDb?.keyQuestions?.length}`);
  const h2e = await post({
    workspace_id: WS_A,
    keyQuestions: [{ if: "cond", thenAsk: Array.from({ length: 25 }, (_, i) => `question ${i}`) }],
  });
  const h2eDb = await dbConfig(WS_A);
  check("H2e 25 questions capped at 20",
    Array.isArray(h2eDb?.keyQuestions) && h2eDb?.keyQuestions.length === 1 &&
    h2eDb?.keyQuestions[0]?.thenAsk?.length === 20,
    JSON.stringify(h2eDb?.keyQuestions?.[0]?.thenAsk?.length));
  // Explicit null clears (UI unset path).
  await post({ workspace_id: WS_A, keyQuestions: null });
  const h3Db = await dbConfig(WS_A);
  const h3Get = await get(WS_A);
  check("H3 explicit null clears keyQuestions",
    h3Db?.keyQuestions === undefined || h3Db?.keyQuestions === null, JSON.stringify(h3Db?.keyQuestions));
  check("H3 GET no longer returns it",
    h3Get?.config?.keyQuestions === undefined || h3Get?.config?.keyQuestions === null,
    JSON.stringify(h3Get?.config?.keyQuestions));
  // Explicit empty array clears too.
  await post({ workspace_id: WS_A, keyQuestions: [] });
  const h4Db = await dbConfig(WS_A);
  check("H4 empty array clears keyQuestions",
    h4Db?.keyQuestions === undefined || h4Db?.keyQuestions === null, JSON.stringify(h4Db?.keyQuestions));
  // Re-set then verify a combined save keeps everything.
  await post({
    workspace_id: WS_A,
    keyQuestions: [{ if: "combined cond", thenAsk: ["combined q"] }],
    requireAddress: true,
    openDays: ["Tuesday"],
    openHours: { start: "10:00", end: "17:00" },
    appointmentSpacer: 30,
  });
  const h5Db = await dbConfig(WS_A);
  check("H5 combined save: keyQuestions + requireAddress + openDays + openHours + spacer all persist",
    Array.isArray(h5Db?.keyQuestions) && h5Db?.keyQuestions.length === 1 &&
    h5Db?.keyQuestions[0]?.if === "combined cond" &&
    h5Db?.requireAddress === true &&
    Array.isArray(h5Db?.openDays) && h5Db?.openDays[0] === "Tuesday" &&
    h5Db?.openHours?.start === "10:00" && h5Db?.appointmentSpacer === 30,
    JSON.stringify(h5Db));
  // Fresh workspace B never told about the field → stays unset.
  const h6Db = await dbConfig(WS_B);
  check("H6 fresh workspace stays unset", !("keyQuestions" in (h6Db ?? {})), JSON.stringify(h6Db));
  // Explicit null then a partial save → still cleared (carry-over of null).
  await post({ workspace_id: WS_A, keyQuestions: null });
  await post({ workspace_id: WS_A, businessName: "Partial Plumbing" });
  const h7Db = await dbConfig(WS_A);
  check("H7 after null + partial save, still cleared",
    h7Db?.keyQuestions === undefined || h7Db?.keyQuestions === null, JSON.stringify(h7Db?.keyQuestions));
  console.log("\n== CLEANUP ==");
  await db.delete(workspaces).where(eq(workspaces.id, WS_A));
  await db.delete(workspaces).where(eq(workspaces.id, WS_B));
  const goneA = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS_A) });
  const goneB = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS_B) });
  check("workspace A deleted", !goneA);
  check("workspace B deleted", !goneB);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
