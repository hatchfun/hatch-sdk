import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { HatchClient } from "../src";

const TOKEN_DECIMALS = 9;

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
const mint = process.env.CTO_MINT;
const action = process.env.ACTION ?? "status";
const amount = process.env.AMOUNT ?? "0";

if (!rpcUrl || !mint) {
  throw new Error("Set RPC_URL and CTO_MINT before running.");
}

const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf-8"))),
);
const connection = new Connection(rpcUrl, "confirmed");
const hatch = new HatchClient({ connection, signer });
const tokenMint = new PublicKey(mint);

if (action === "status") {
  const status = await hatch.getCtoStakingStatus({ mint: tokenMint });
  console.log("Is CTO:", status.isCto);
  console.log("Total staked raw:", status.totalStakedRaw.toString());
  console.log("Your staked raw:", status.stakedRaw.toString());
  console.log("Pending WSOL lamports:", status.pendingRewardsWsolRaw.toString());
  console.log("Pending token raw:", status.pendingRewardsTokenRaw.toString());
} else if (action === "stake") {
  const result = await hatch.stakeCto({
    mint: tokenMint,
    amount: parseTokenAmount(amount),
  });
  console.log("Stake tx:", result.signature);
} else if (action === "unstake") {
  const result = await hatch.unstakeCto({
    mint: tokenMint,
    amount: parseTokenAmount(amount),
  });
  console.log("Unstake tx:", result.signature);
} else if (action === "claim") {
  const result = await hatch.claimCtoStakingFees({ mint: tokenMint });
  console.log("Claim tx:", result.signature);
} else {
  throw new Error(`Unsupported ACTION: ${action}`);
}

function parseTokenAmount(input: string): bigint {
  const [whole, fraction = ""] = input.trim().split(".");
  const paddedFraction = fraction.padEnd(TOKEN_DECIMALS, "0").slice(0, TOKEN_DECIMALS);
  return BigInt(whole || "0") * BigInt(10 ** TOKEN_DECIMALS) + BigInt(paddedFraction || "0");
}
