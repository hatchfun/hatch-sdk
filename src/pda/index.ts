import { Connection, PublicKey } from "@solana/web3.js";
import {
  HATCH_PROGRAM_ID,
  LAUNCHER_PDA_REFERRER_OFFSET,
  LAUNCHER_PDA_SEED,
  LAUNCH_STATE_SEED,
  LAUNCH_TOKEN_ACCOUNT_SEED,
  METEORA_DLMM_PROGRAM_ID,
  METEORA_EVENT_AUTHORITY_SEED,
  POOL_FEES_SEED,
  REFERRER_FEE_SEED,
} from "../constants/addresses";

export function deriveLauncherPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LAUNCHER_PDA_SEED, authority.toBuffer()],
    HATCH_PROGRAM_ID,
  );
}

export function deriveLaunchTokenAccount(
  tokenMint: PublicKey,
  launcherPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LAUNCH_TOKEN_ACCOUNT_SEED, tokenMint.toBuffer(), launcherPda.toBuffer()],
    HATCH_PROGRAM_ID,
  );
}

export function deriveLaunchState(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LAUNCH_STATE_SEED, tokenMint.toBuffer()],
    HATCH_PROGRAM_ID,
  );
}

export function deriveMeteorEventAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([METEORA_EVENT_AUTHORITY_SEED], METEORA_DLMM_PROGRAM_ID);
}

export function derivePoolFeeAccount(
  launcherPda: PublicKey,
  lbPair: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_FEES_SEED, launcherPda.toBuffer(), lbPair.toBuffer()],
    HATCH_PROGRAM_ID,
  );
}

export async function launcherPdaExists(
  connection: Connection,
  authority: PublicKey,
): Promise<boolean> {
  const [launcherPda] = deriveLauncherPda(authority);
  const accountInfo = await connection.getAccountInfo(launcherPda);
  return accountInfo !== null;
}

export function deriveReferrerFeeAccount(
  referrerLauncherPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REFERRER_FEE_SEED, referrerLauncherPda.toBuffer()],
    HATCH_PROGRAM_ID,
  );
}

/**
 * Read the referrer field from an on-chain LauncherPda account.
 * Returns null if no referrer (all zeros) or account doesn't exist.
 */
export async function readLauncherPdaReferrer(
  connection: Connection,
  authority: PublicKey,
): Promise<PublicKey | null> {
  const [launcherPda] = deriveLauncherPda(authority);
  const accountInfo = await connection.getAccountInfo(launcherPda);
  if (!accountInfo || accountInfo.data.length < LAUNCHER_PDA_REFERRER_OFFSET + 32) {
    return null;
  }
  const referrerBytes = accountInfo.data.subarray(
    LAUNCHER_PDA_REFERRER_OFFSET,
    LAUNCHER_PDA_REFERRER_OFFSET + 32,
  );
  const referrer = new PublicKey(referrerBytes);
  const isDefault = referrer.equals(new PublicKey(new Uint8Array(32)));
  return isDefault ? null : referrer;
}
