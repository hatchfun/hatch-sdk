import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { HatchClient, LAUNCH_MODE_CTO } from "../src";

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

const rpcUrl = process.env.RPC_URL;
const keypairPath =
  process.env.SIGNER_KEYPAIR_PATH ?? resolve(__dirname, "..", ".smoke-keypair.json");
const name = process.env.TOKEN_NAME ?? "CTO Token";
const symbol = process.env.TOKEN_SYMBOL ?? "CTO";
const uri = process.env.METADATA_URI;

if (!rpcUrl || !uri) {
  throw new Error("Set RPC_URL and METADATA_URI before running.");
}

const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf-8"))),
);
const connection = new Connection(rpcUrl, "confirmed");
const hatch = new HatchClient({ connection, signer });

const result = await hatch.launch({
  name,
  symbol,
  uri,
  launchMode: LAUNCH_MODE_CTO,
});

console.log("CTO token launched");
console.log("Mint:", result.mint.toBase58());
console.log("Pool:", result.lbPair.toBase58());
if (result.setupSignature) console.log("Wallet setup tx:", result.setupSignature);
if (result.ctoSetupSignature) console.log("CTO setup tx:", result.ctoSetupSignature);
console.log("Pool tx:", result.signature);
