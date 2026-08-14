#!/usr/bin/env bash
# E2E test for FK-safe lead/appointment deletion fix
set -euo pipefail
cd /home/team/shared/site

COOKIE_JAR=$(mktemp)
cleanup() { rm -f "$COOKIE_JAR"; }
trap cleanup EXIT

echo "=== 1. Sign up throwaway test workspace ==="
SIGNUP=$(curl -s -c "$COOKIE_JAR" -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"fk-test@test.com","password":"test12345678","name":"FK Test"}')
WS_ID=$(echo "$SIGNUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['workspaceId'])")
echo "Workspace: $WS_ID"

echo ""
echo "=== 2. Seed lead + call, appointment + call (direct DB) ==="
source .env.local
export DATABASE_URL
bun -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const wsId = '$WS_ID';
const { randomUUID } = require('crypto');

const leadId = randomUUID();
const apptId = randomUUID();
const leadCallId = randomUUID();
const apptCallId = randomUUID();

// Lead
await sql\`INSERT INTO leads (id, workspace_id, name, email, phone, source, status, score, created_at, updated_at)
  VALUES (\${leadId}, \${wsId}, 'FK Test Lead', 'fk-lead@test.com', '+15550001111', 'manual', 'new', 50, now(), now())\`;

// Call referencing the lead
await sql\`INSERT INTO calls (id, workspace_id, call_sid, caller_number, to_number, status, outcome, started_at, ended_at, lead_id, appointment_id)
  VALUES (\${leadCallId}, \${wsId}, 'CAfktestlead001', '+15550001111', '+15550002222', 'completed', 'lead_captured', now(), now(), \${leadId}, null)\`;

// Appointment
await sql\`INSERT INTO appointments (id, workspace_id, title, lead_id, scheduled_at, status, created_at)
  VALUES (\${apptId}, \${wsId}, 'FK Test Appointment', null, now() + interval '1 day', 'scheduled', now())\`;

// Call referencing the appointment
await sql\`INSERT INTO calls (id, workspace_id, call_sid, caller_number, to_number, status, outcome, started_at, ended_at, lead_id, appointment_id)
  VALUES (\${apptCallId}, \${wsId}, 'CAfktestappt001', '+15550001111', '+15550002222', 'completed', 'appointment_booked', now(), now(), null, \${apptId})\`;

console.log(JSON.stringify({ leadId, apptId, leadCallId, apptCallId }));
" 2>&1 | grep -E '^\{' > /tmp/fk-seed.json
cat /tmp/fk-seed.json
LEAD_ID=$(python3 -c "import json; print(json.load(open('/tmp/fk-seed.json'))['leadId'])")
APPT_ID=$(python3 -c "import json; print(json.load(open('/tmp/fk-seed.json'))['apptId'])")

echo ""
echo "=== 3. DELETE lead (was 500 before fix) ==="
curl -s -b "$COOKIE_JAR" -w "\nHTTP %{http_code}\n" -X DELETE "http://localhost:3000/api/workspace/leads?id=$LEAD_ID"
echo ""
echo "=== 4. DELETE appointment (was 500 before fix) ==="
curl -s -b "$COOKIE_JAR" -w "\nHTTP %{http_code}\n" -X DELETE "http://localhost:3000/api/workspace/appointments?id=$APPT_ID"

echo ""
echo "=== 5. Verify rows: lead+appt gone, calls remain with NULLed refs ==="
bun -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const wsId = '$WS_ID';
const leadId = '$LEAD_ID';
const apptId = '$APPT_ID';

const lead = await sql\`SELECT count(*)::int as c FROM leads WHERE id = \${leadId}\`;
const appt = await sql\`SELECT count(*)::int as c FROM appointments WHERE id = \${apptId}\`;
const leadCall = await sql\`SELECT lead_id, appointment_id FROM calls WHERE workspace_id = \${wsId} AND call_sid = 'CAfktestlead001'\`;
const apptCall = await sql\`SELECT lead_id, appointment_id FROM calls WHERE workspace_id = \${wsId} AND call_sid = 'CAfktestappt001'\`;

console.log('Lead rows remaining:', lead[0].c, '(expect 0)');
console.log('Appointment rows remaining:', appt[0].c, '(expect 0)');
console.log('Call refs (lead call) lead_id:', leadCall[0].lead_id, '(expect null)');
console.log('Call refs (appt call) appointment_id:', apptCall[0].appointment_id, '(expect null)');
const ok = lead[0].c === 0 && appt[0].c === 0 && leadCall[0].lead_id === null && apptCall[0].appointment_id === null;
console.log(ok ? 'PASS ✅' : 'FAIL ❌');
" 2>&1

echo ""
echo "=== 6. Clean up test workspace ==="
curl -s -b "$COOKIE_JAR" -w "\nHTTP %{http_code}\n" -X DELETE "http://localhost:3000/api/workspace"
echo ""
echo "Workspaces remaining:"
bun -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const rows = await sql\`SELECT id FROM workspaces\`;
console.log(rows.map(r => r.id).join('\n'));
" 2>&1
