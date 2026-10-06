import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { derivePasswordHash, PASSWORD_ITERATIONS } from "../lib/password-hash.ts";

// Independent OpenSSL result checks compatibility with existing stored hashes.
const password = "Contraseña-🔐-".repeat(7);
const salt = randomBytes(16);
const expected = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
assert.deepEqual(Buffer.from(await derivePasswordHash(password, salt, PASSWORD_ITERATIONS)), expected);

const nativeDeriveBits = crypto.subtle.deriveBits;
let rejectedCalls = 0;
crypto.subtle.deriveBits = async function (params, ...args) {
  if (params.name === "PBKDF2" && params.iterations > 100_000) {
    rejectedCalls += 1;
    throw new DOMException("Pbkdf2 failed: iteration counts above 100000 are not supported", "NotSupportedError");
  }
  return nativeDeriveBits.call(this, params, ...args);
};
try {
  assert.deepEqual(Buffer.from(await derivePasswordHash(password, salt, PASSWORD_ITERATIONS)), expected);
  assert.equal(rejectedCalls, 1);
  crypto.subtle.deriveBits = async () => { throw new DOMException("Invalid parameters", "OperationError"); };
  await assert.rejects(derivePasswordHash(password, salt, PASSWORD_ITERATIONS), { name: "OperationError" });
} finally {
  crypto.subtle.deriveBits = nativeDeriveBits;
}
console.log("PASS: native and capped-runtime hashes match OpenSSL at 600,000 iterations; unexpected errors are preserved.");
