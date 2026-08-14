/**
 * Password hashing utilities using Bun's built-in bcrypt implementation.
 * No external dependencies required — Bun.password uses bcrypt internally.
 */

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
