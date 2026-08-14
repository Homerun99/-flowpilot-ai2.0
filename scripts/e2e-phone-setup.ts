// E2E test setup — create a SECOND test workspace and provision a REAL Twilio
// number for it (Option B flow). Prints the number + SID for verification.
import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { provisionForWorkspace, twilioConfigured } from "../src/lib/twilio-provision";

const WS_ID = "ws_phone_test";

// 1. Create the test workspace if missing
const existing = await db.query.workspaces.findFirst({
  where: eq(workspaces.id, WS_ID),
  columns: { id: true },
});
if (!existing) {
  await db.insert(workspaces).values({
    id: WS_ID,
    name: "Test Roofing Co",
    fromName: "Test Roofing Co",
    fromEmail: "test@klerkitai.com",
    receptionistConfig: {
      businessName: "Test Roofing Co",
      businessType: "roofing",
      businessHours: "9am-5pm",
      description: "Roofing repair and replacement company",
    },
  });
  console.log("created workspace", WS_ID);
} else {
  console.log("workspace already exists:", WS_ID);
}

// 2. Provision a real Twilio number (find → purchase → set VoiceUrl+StatusCallback)
console.log("twilioConfigured:", twilioConfigured());
const result = await provisionForWorkspace();
if (!result) {
  console.error("PROVISION FAILED — no number");
  process.exit(1);
}
console.log("provisioned:", JSON.stringify(result));

// 3. Store the number + SID on the workspace
await db
  .update(workspaces)
  .set({
    twilioPhone: result.number,
    twilioPhoneSid: result.sid,
    phoneMode: "provisioned",
  })
  .where(eq(workspaces.id, WS_ID));
console.log("stored on", WS_ID);

// 4. Print final workspace state
const ws = await db.query.workspaces.findFirst({
  where: eq(workspaces.id, WS_ID),
  columns: { id: true, twilioPhone: true, twilioPhoneSid: true, phoneMode: true, receptionistConfig: true },
});
console.log("workspace state:", JSON.stringify(ws));
