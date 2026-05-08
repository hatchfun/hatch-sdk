import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { HATCH_PROGRAM_ID, WSOL_MINT } from "../../constants/addresses";
import {
  deriveCtoFeeVaultX,
  deriveCtoFeeVaultY,
  deriveCtoStakePool,
  deriveCtoStakeVault,
  deriveLaunchState,
  deriveLauncherPda,
} from "../../pda";

const DISCRIMINATOR = Buffer.from([236, 112, 35, 58, 217, 105, 194, 149]);
const FEE_VAULT_X_DISCRIMINATOR = Buffer.from([42, 105, 23, 197, 213, 78, 220, 166]);
const FEE_VAULT_Y_DISCRIMINATOR = Buffer.from([218, 15, 184, 92, 255, 60, 14, 177]);

export function buildInitializeCtoStakePoolIx(params: {
  authority: PublicKey;
  tokenMint: PublicKey;
  tokenProgramX: PublicKey;
}): TransactionInstruction {
  const { authority, tokenMint, tokenProgramX } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [stakeVault] = deriveCtoStakeVault(stakePool);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: launchState, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgramX, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISCRIMINATOR,
  });
}

export function buildInitializeCtoFeeVaultXIx(params: {
  authority: PublicKey;
  tokenMint: PublicKey;
  tokenProgramX: PublicKey;
}): TransactionInstruction {
  const { authority, tokenMint, tokenProgramX } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [feeVaultX] = deriveCtoFeeVaultX(stakePool);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: launchState, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: false },
      { pubkey: feeVaultX, isSigner: false, isWritable: true },
      { pubkey: tokenProgramX, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: FEE_VAULT_X_DISCRIMINATOR,
  });
}

export function buildInitializeCtoFeeVaultYIx(params: {
  authority: PublicKey;
  tokenMint: PublicKey;
}): TransactionInstruction {
  const { authority, tokenMint } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [feeVaultY] = deriveCtoFeeVaultY(stakePool);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: launchState, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: false },
      { pubkey: feeVaultY, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: FEE_VAULT_Y_DISCRIMINATOR,
  });
}
