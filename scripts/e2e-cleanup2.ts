import { db } from "../src/db/index";
import { workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
try { const { releaseNumber } = await import("../src/lib/twilio-provision"); await releaseNumber("PN57981e6c9a2ec1c9c02c8b23c5ad2941"); console.log("number released"); } catch (e) { console.log("release err:", String((e as Error)?.message ?? e).slice(0,100)); }
await db.delete(workspaces).where(eq(workspaces.id, "ws_phone_test"));
console.log("workspace deleted");
