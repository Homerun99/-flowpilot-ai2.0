/**
 * JWT session management using jose (lightweight, WebCrypto-based).
 *
 * Sessions are 7-day httpOnly cookies named "fp_session".
 * Payload: { userId, workspaceId, email }
 */

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "flowpilot-dev-secret-change-in-production"
);

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = "fp_session";

export interface SessionPayload {
  userId: string;
  workspaceId: string;
  email: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_DURATION_MS / 1000)
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(headers: Headers, token: string): void {
  headers.set(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
  );
}

export function clearSessionCookie(headers: Headers): void {
  headers.set(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

export function getSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`)
  );
  return match?.[1] || null;
}
