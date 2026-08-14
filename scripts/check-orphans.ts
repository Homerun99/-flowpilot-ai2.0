import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const kept = ['0c4951ca-0a19-418e-842d-3d2c57ca9c4a','ws_2w3a8uul','ws_demo_001'];
const tables = ['activity_log','automation_runs','calls','proposals','appointments','invoices','documents','automations','leads','ai_employees','users'];

let orphans = 0;
for (const t of tables) {
  const rows = await sql.query(`SELECT workspace_id FROM ${t}`) as any[];
  const bad = rows.filter((r: any) => r.workspace_id && !kept.includes(r.workspace_id));
  if (bad.length > 0) {
    const ids = [...new Set(bad.map((r: any) => r.workspace_id))];
    console.log(`ORPHANS in ${t}: ${bad.length} rows, workspace_ids:`, ids);
    orphans += bad.length;
  }
}
console.log(orphans === 0 ? '✅ 0 orphaned rows across all tables' : `⚠️ ${orphans} total orphaned rows`);
