// Live end-to-end check (task 3acef0fe) against the RUNNING server on port
// 3000: structured openDays/openHours round-trip on a throwaway workspace,
// plus read-back of the owner workspace (ws_2w3a8uul) showing the structured
// fields set via the API. Cleans up the throwaway workspace.
// Run: bun scripts/config-roundtrip-live.ts  (already exists) — this adds E.
import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";

const BASE = "http://localhost:3000";
const WS = "ws_sh_live_check";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

async function main() {
  await db.insert(workspaces).values({ id: WS, name: "Structured Live Check" }).onConflictDoNothing();
  console.log("== LIVE structured hours round-trip (port 3000) ==");

  const post = await fetch(`${BASE}/api/workspace/receptionist-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: WS,
      businessName: "Structured Live Plumbing",
      openDays: ["Tuesday", "Wednesday", "Thursday", "Friday"],
      openHours: { start: "10:00", end: "17:00" },
      requireAddress: true,
    }),
  });
  const postJson = await post.json();
  check("POST 200", post.status === 200, `status=${post.status}`);
  check("POST response openDays (4)", Array.isArray(postJson?.config?.openDays) && postJson?.config?.openDays.length === 4, JSON.stringify(postJson?.config?.openDays));
  check("POST response openHours", postJson?.config?.openHours?.start === "10:00" && postJson?.config?.openHours?.end === "17:00", JSON.stringify(postJson?.config?.openHours));

  const get = await fetch(`${BASE}/api/workspace/receptionist-config?workspace=${WS}`);
  const getJson = await get.json();
  check("GET returns openDays", Array.isArray(getJson?.config?.openDays) && getJson?.config?.openDays.length === 4, JSON.stringify(getJson?.config?.openDays));
  check("GET returns openHours", getJson?.config?.openHours?.start === "10:00" && getJson?.config?.openHours?.end === "17:00", JSON.stringify(getJson?.config?.openHours));

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS), columns: { receptionistConfig: true } });
  const cfg = (ws?.receptionistConfig as Record<string, unknown>) ?? {};
  check("DB row has openDays + openHours", Array.isArray(cfg.openDays) && (cfg.openHours as any)?.end === "17:00", JSON.stringify(cfg));

  console.log("== owner workspace read-back (structured set via API) ==");
  const owner = await fetch(`${BASE}/api/workspace/receptionist-config?workspace=ws_2w3a8uul`);
  const ownerJson = await owner.json();
  const oc = ownerJson?.config ?? {};
  check("owner openDays Tue-Fri", Array.isArray(oc.openDays) && oc.openDays[0] === "Tuesday" && oc.openDays[3] === "Friday", JSON.stringify(oc.openDays));
  check("owner openHours 10:00-17:00", oc.openHours?.start === "10:00" && oc.openHours?.end === "17:00", JSON.stringify(oc.openHours));
  check("owner requireAddress preserved", oc.requireAddress === true, JSON.stringify(oc.requireAddress));
  check("owner businessName preserved", oc.businessName === "plumingcentral", JSON.stringify(oc.businessName));

  await db.delete(workspaces).where(eq(workspaces.id, WS));
  const gone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS) });
  check("cleanup: throwaway deleted", !gone);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
