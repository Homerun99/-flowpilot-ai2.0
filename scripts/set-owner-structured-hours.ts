// Set structured openDays/openHours on the owner workspace (ws_2w3a8uul) via
// the real API handler — abcplumming: Tue-Fri 10am-5pm America/Phoenix.
// Preserves all existing fields (businessName, requireAddress, nulls).
// Run: bun scripts/set-owner-structured-hours.ts
import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { handleApiRequest } from "../api-handler.ts";

const OWNER = "ws_2w3a8uul";

const res = await handleApiRequest(
  "/api/workspace/receptionist-config",
  "POST",
  new Request("http://localhost/api/workspace/receptionist-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: OWNER,
      businessName: "plumingcentral",
      businessType: null,
      businessHours: null,
      description: null,
      customInstructions: null,
      requireAddress: true,
      openDays: ["Tuesday", "Wednesday", "Thursday", "Friday"],
      openHours: { start: "10:00", end: "17:00" },
    }),
  })
);
const json = await res!.json();
console.log("POST status:", res!.status, JSON.stringify(json));

const ws = await db.query.workspaces.findFirst({
  where: eq(workspaces.id, OWNER),
  columns: { receptionistConfig: true, timezone: true },
});
console.log("DB row:", JSON.stringify(ws));
const cfg = (ws?.receptionistConfig as Record<string, unknown>) ?? {};
const ok =
  Array.isArray(cfg.openDays) && cfg.openDays.length === 4 &&
  cfg.openDays[0] === "Tuesday" && cfg.openDays[3] === "Friday" &&
  (cfg.openHours as any)?.start === "10:00" && (cfg.openHours as any)?.end === "17:00" &&
  cfg.requireAddress === true;
console.log(ok ? "OK: structured hours set, requireAddress preserved" : "FAILED");
process.exit(ok ? 0 : 1);
