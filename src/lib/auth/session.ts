/**
 * Session resolution utility — extracts and verifies the JWT session from
 * an incoming request. Used by API routes to scope data to the user's workspace.
 *
 * Falls back to the demo workspace when no session is present (backward compat).
 */

import { getSessionCookie, verifySessionToken, type SessionPayload } from "./jwt";

export const DEMO_WORKSPACE = "ws_demo_001";

export interface SessionResult {
  userId: string | null;
  workspaceId: string;
  email: string | null;
  isDemo: boolean;
}

/**
 * Resolve the session from a request.
 * Returns the demo workspace when no valid session exists.
 */
export async function getSession(request: Request): Promise<SessionResult> {
  const token = getSessionCookie(request);
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      return {
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        email: payload.email,
        isDemo: false,
      };
    }
  }
  return {
    userId: null,
    workspaceId: DEMO_WORKSPACE,
    email: null,
    isDemo: true,
  };
}
