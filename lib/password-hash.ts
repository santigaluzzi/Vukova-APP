import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const PASSWORD_ITERATIONS = 600_000;

export async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
    try {
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: new Uint8Array(salt).buffer, iterations, hash: "SHA-256" },
        key,
        256,
      );
      return new Uint8Array(bits);
    } catch (error) {
      // Hosted Workers can cap native PBKDF2 at 100,000 iterations, while local
      // workerd has no cap. Preserve the standard hash and its full work factor.
      if (!(error instanceof Error) || error.name !== "NotSupportedError") throw error;
      console.info("auth.password_hash: using portable PBKDF2 after native NotSupportedError");
      return await pbkdf2Async(sha256, passwordBytes, salt, { c: iterations, dkLen: 32 });
    }
  } finally {
    passwordBytes.fill(0);
  }
}
