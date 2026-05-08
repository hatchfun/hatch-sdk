import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  HATCH_PROGRAM_ID,
  LAUNCH_MODE_NORMAL,
  isSupportedLaunchMode,
  type LaunchMode,
} from "../../constants/addresses";
import { deriveLaunchState, deriveLauncherPda, deriveLaunchTokenAccount } from "../../pda";
import { getInstructionDiscriminator } from "../../utils/discriminator";

const DISCRIMINATOR = getInstructionDiscriminator("initialize_launch_state");

export function buildInitializeLaunchStateIx(
  authority: PublicKey,
  tokenMint: PublicKey,
  mode: LaunchMode = LAUNCH_MODE_NORMAL,
): TransactionInstruction {
  if (!isSupportedLaunchMode(mode)) {
    throw new Error(`Unsupported launch mode: ${mode}`);
  }

  const [launcherPda] = deriveLauncherPda(authority);
  const [launchTokenAccount] = deriveLaunchTokenAccount(tokenMint, launcherPda);
  const [launchState] = deriveLaunchState(tokenMint);
  const data = Buffer.concat([DISCRIMINATOR, Buffer.from([mode])]);

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
    data,
  });
}
