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
import { getInstructionDiscriminator } from "../../utils/discriminator";

const DISCRIMINATOR = getInstructionDiscriminator("initialize_cto_stake_pool");
const FEE_VAULT_X_DISCRIMINATOR = getInstructionDiscriminator("initialize_cto_fee_vault_x");
const FEE_VAULT_Y_DISCRIMINATOR = getInstructionDiscriminator("initialize_cto_fee_vault_y");

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
