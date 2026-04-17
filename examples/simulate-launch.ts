/**
 * Simulation helper: builds the real launch transaction(s) with `dryRun: true`
 * and asks RPC to simulate them without sending.
 *
 * Reads:
 *   - RPC_URL from env (or examples/.env)
 *   - SIGNER_KEYPAIR_PATH from env (defaults to ../.smoke-keypair.json)
 *   - METADATA_URI from env
 *   - TOKEN_NAME from env (defaults to "Simulation Token")
 *   - TOKEN_SYMBOL from env (defaults to "SIM")
 *
 * Run:
 *   pnpm tsx examples/simulate-launch.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { HatchClient } from "../src";
import { deriveLauncherPda } from "../src/pda";

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
    // file not present
  }
}

loadEnvFile(resolve(__dirname, ".env"));

const RPC_URL = process.env.RPC_URL;
const KEYPAIR_PATH =
  process.env.SIGNER_KEYPAIR_PATH ?? resolve(__dirname, "..", ".smoke-keypair.json");
const METADATA_URI = process.env.METADATA_URI;
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Simulation Token";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "SIM";

if (!RPC_URL) {
  console.error("ERROR: RPC_URL env var is required.");
  process.exit(1);
}
if (!METADATA_URI) {
  console.error("ERROR: METADATA_URI env var is required.");
  process.exit(1);
}

function formatSimulation(name: string, value: unknown): void {
  console.log(`\n[${name}]`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8")));
  const signer = Keypair.fromSecretKey(secretKey);
  const connection = new Connection(RPC_URL, "confirmed");
  const [launcherPda] = deriveLauncherPda(signer.publicKey);

  console.log("Signer:", signer.publicKey.toBase58());
  console.log("Launcher PDA:", launcherPda.toBase58());

  const balanceLamports = await connection.getBalance(signer.publicKey);
  console.log(`Balance: ${balanceLamports / LAMPORTS_PER_SOL} SOL`);

  const launcherExists = (await connection.getAccountInfo(launcherPda)) !== null;
  console.log(`Launcher exists on-chain: ${launcherExists}`);

  const hatch = new HatchClient({ connection, signer });
  const launch = await hatch.launch({
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: METADATA_URI,
    dryRun: true,
  });

  console.log("\nBuilt dry-run launch payload:");
  console.log(`Mint: ${launch.mint.toBase58()}`);
  console.log(`LB Pair: ${launch.lbPair.toBase58()}`);
  console.log(`Position: ${launch.position.toBase58()}`);
  console.log(`Has setup transaction: ${Boolean(launch.setupTransaction)}`);

  if (launch.setupTransaction) {
    const setupSim = await connection.simulateTransaction(launch.setupTransaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    formatSimulation("Setup Simulation", setupSim.value);
  }

  const launchSim = await connection.simulateTransaction(launch.transaction!, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  formatSimulation("Launch Simulation", launchSim.value);

  if (launch.setupTransaction) {
    console.log(
      "\nNote: setup and launch are simulated independently. If setup is required, launch simulation may fail until the setup transaction is actually sent and confirmed on-chain.",
    );
  }
}

main().catch((err) => {
  console.error("Simulation failed:");
  console.error(err);
  process.exit(1);
});
