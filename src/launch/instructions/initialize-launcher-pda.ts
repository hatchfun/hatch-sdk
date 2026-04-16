import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { HATCH_PROGRAM_ID } from "../../constants/addresses";
import { deriveLauncherPda } from "../../pda";

const DISCRIMINATOR = Buffer.from([149, 59, 86, 45, 74, 12, 137, 15]);

/**
 * Build instruction to initialize a LauncherPda for a wallet.
 *
 * @param authority - The wallet that will own this LauncherPda (signer)
 * @param referrerLauncherPda - Optional: the referrer's LauncherPda pubkey.
 *   If provided, the on-chain program stores it as the immutable referrer.
 *   The referrer's LauncherPda must already exist on-chain.
 */
export function buildInitializeLauncherPdaIx(
  authority: PublicKey,
  referrerLauncherPda?: PublicKey,
): TransactionInstruction {
  const [launcherPda] = deriveLauncherPda(authority);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: launcherPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Referrer's LauncherPda goes in remaining_accounts[0]
  if (referrerLauncherPda) {
    keys.push({ pubkey: referrerLauncherPda, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    keys,
    programId: HATCH_PROGRAM_ID,
    data: DISCRIMINATOR,
  });
}
