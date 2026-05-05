import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { HATCH_PROGRAM_ID, LAUNCH_MODE_NORMAL } from "../../constants/addresses";
import { deriveLaunchState, deriveLauncherPda, deriveLaunchTokenAccount } from "../../pda";

const DISCRIMINATOR = Buffer.from([43, 136, 170, 96, 251, 157, 75, 235]);

export function buildInitializeLaunchStateIx(
  authority: PublicKey,
  tokenMint: PublicKey,
): TransactionInstruction {
  const [launcherPda] = deriveLauncherPda(authority);
  const [launchTokenAccount] = deriveLaunchTokenAccount(tokenMint, launcherPda);
  const [launchState] = deriveLaunchState(tokenMint);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: launchTokenAccount, isSigner: false, isWritable: false },
      { pubkey: launchState, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISCRIMINATOR, Buffer.from([LAUNCH_MODE_NORMAL])]),
  });
}
