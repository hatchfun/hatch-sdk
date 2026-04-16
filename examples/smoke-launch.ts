/**
 * Smoke test: runs a real launch on mainnet using the SDK.
 *
 * Reads:
 *   - RPC_URL from env (or the NEXT_PUBLIC_RPC_ENDPOINT in examples/.env)
 *   - SIGNER_KEYPAIR_PATH from env (defaults to ../.smoke-keypair.json)
 *   - METADATA_URI from env
 *
 * Run:
 *   pnpm tsx examples/smoke-launch.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { HatchClient } from "../src";

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file not present — fine
  }
}

loadEnvFile(resolve(__dirname, ".env"));

const RPC_URL = process.env.RPC_URL;
const KEYPAIR_PATH =
  process.env.SIGNER_KEYPAIR_PATH ?? resolve(__dirname, "..", ".smoke-keypair.json");
const METADATA_URI = process.env.METADATA_URI;

if (!RPC_URL) {
  console.error("ERROR: RPC_URL env var is required.");
  process.exit(1);
}
if (!METADATA_URI) {
  console.error("ERROR: METADATA_URI env var is required.");
  process.exit(1);
}

async function main() {
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8")));
  const signer = Keypair.fromSecretKey(secretKey);
  const connection = new Connection(RPC_URL!, "confirmed");

  console.log("Signer:", signer.publicKey.toBase58());
  const balLamports = await connection.getBalance(signer.publicKey);
  const balSol = balLamports / LAMPORTS_PER_SOL;
  console.log(`Balance: ${balSol} SOL`);
  if (balSol < 0.26) {
    console.error(
      `Signer has ${balSol} SOL — need ~0.26 SOL to launch. Fund ${signer.publicKey.toBase58()} and retry.`,
    );
    process.exit(1);
  }

  const hatch = new HatchClient({ connection, signer });

  console.log("\n[1/3] Launching token...");
  const launch = await hatch.launch({
    name: "Openclaw Launched This",
    symbol: "CLAW",
    uri: METADATA_URI!,
  });
  if (launch.setupSignature) {
    console.log(`  setup tx: https://solscan.io/tx/${launch.setupSignature}`);
  }
  console.log(`  launch:   https://solscan.io/tx/${launch.signature}`);
  console.log(`  mint:     ${launch.mint.toBase58()}`);
  console.log(`  lbPair:   ${launch.lbPair.toBase58()}`);
  console.log(`  position: ${launch.position.toBase58()}`);

  console.log("\n[2/3] Waiting 4s, then reading launch status...");
  await new Promise((r) => setTimeout(r, 4000));
  const status = await hatch.getLaunchStatus({ mint: launch.mint });
  console.log(`  positions found:       ${status.positions.length}`);
  console.log(`  total claimable SOL:   ${status.totalClaimableSol}`);
  if (status.positions[0]) {
    console.log(`  active bin id:         ${status.positions[0].activeBinId}`);
  }

  console.log("\n[3/3] Attempting a claim (expected to claim ~0 if no trades yet)...");
  try {
    const claim = await hatch.claimFees({ mint: launch.mint });
    console.log(`  positions claimed: ${claim.positionsClaimed}`);
    for (const sig of claim.signatures) {
      console.log(`  claim tx: https://solscan.io/tx/${sig}`);
    }
  } catch (err) {
    console.log(`  claim failed (ok if no fees accrued): ${(err as Error).message}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Smoke test failed:");
  console.error(err);
  process.exit(1);
});
