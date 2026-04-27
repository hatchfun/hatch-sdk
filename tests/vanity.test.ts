import assert from "node:assert/strict";
import test from "node:test";
import { generateVanityKeypair } from "../src/utils/vanity";

test("generateVanityKeypair returns a keypair matching the requested suffix", async () => {
  const result = await generateVanityKeypair({ suffix: "A", yieldEvery: 100 });

  assert.ok(result.keypair.publicKey.toBase58().endsWith("A"));
  assert.ok(result.attempts >= 1);
  assert.ok(result.elapsedMs >= 0);
});
