// Live end-to-end check for task 82bf837e — round-trip against the RUNNING
// server (port 3000), which serves /api/* via serve.ts → api-handler.ts.
// Verifies: POST requireAddress=true → GET returns it → DB row has it →
// workspace without it stays unset. Then cleans up the throwaway workspace.
// Run: bun scripts/config-roundtrip-live.ts
import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";

const BASE = "http://localhost:3000";
const WS = "ws_ra_live_check";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

async function main() {
  await db.insert(workspaces).values({ id: WS, name: "Live RoundTrip Check" }).onConflictDoNothing();
  console.log("== LIVE round-trip against port 3000 ==");

  // POST requireAddress=true
  const post = await fetch(`${BASE}/api/workspace/receptionist-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: WS,
      businessName: "Live Check Plumbing",
      businessType: "plumbing",
      businessHours: "Tue-Fri 10am-5pm",
      description: "Live e2e check",
      customInstructions: "Ask for address",
      requireAddress: true,
    }),
  });
  const postJson = await post.json();
  check("POST 200", post.status === 200, `status=${post.status}`);
  check("POST response requireAddress === true", postJson?.config?.requireAddress === true, JSON.stringify(postJson?.config));

  // GET returns it
  const get = await fetch(`${BASE}/api/workspace/receptionist-config?workspace=${WS}`);
  const getJson = await get.json();
  check("GET requireAddress === true", getJson?.config?.requireAddress === true, JSON.stringify(getJson?.config));

  // DB row has it
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS), columns: { receptionistConfig: true } });
  const cfg = (ws?.receptionistConfig as Record<string, unknown>) ?? {};
  check("DB row requireAddress === true", cfg.requireAddress === true, JSON.stringify(cfg));

  // Control: fresh workspace (B) stays unset
  const WS_B = "ws_ra_live_ctrl";
  await db.insert(workspaces).values({ id: WS_B, name: "Live RoundTrip Ctrl" }).onConflictDoNothing();
  const postB = await fetch(`${BASE}/api/workspace/receptionist-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: WS_B, businessName: "Ctrl Roofing" }),
  });
  const postBJson = await postB.json();
  const wsB = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS_B), columns: { receptionistConfig: true } });
  const cfgB = (wsB?.receptionistConfig as Record<string, unknown>) ?? {};
  check("Control POST omits requireAddress", !("requireAddress" in (postBJson?.config ?? {})), JSON.stringify(postBJson?.config));
  check("Control DB has no requireAddress (default false)", !("requireAddress" in cfgB), JSON.stringify(cfgB));

  // Cleanup
  await db.delete(workspaces).where(eq(workspaces.id, WS));
  await db.delete(workspaces).where(eq(workspaces.id, WS_B));
  const gone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS) });
  const goneB = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS_B) });
  check("cleanup: test workspaces deleted", !gone && !goneB);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
