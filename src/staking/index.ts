import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { HATCH_PROGRAM_ID, WSOL_MINT } from "../constants";
import {
  deriveCtoFeeVaultX,
  deriveCtoFeeVaultY,
  deriveCtoStakePool,
  deriveCtoStakeVault,
  deriveLaunchState,
  deriveUserStake,
} from "../pda";

const STAKE_CTO_DISCRIMINATOR = Buffer.from([119, 179, 130, 53, 127, 170, 8, 29]);
const UNSTAKE_CTO_DISCRIMINATOR = Buffer.from([241, 127, 66, 96, 211, 130, 179, 79]);
const CLAIM_CTO_STAKING_FEES_DISCRIMINATOR = Buffer.from([
  205, 214, 205, 126, 115, 139, 28, 95,
]);

function writeU64Le(target: Buffer, value: bigint, offset: number): void {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) {
    throw new RangeError("u64 value out of range");
  }

  let remaining = value;
  for (let i = 0; i < 8; i += 1) {
    target[offset + i] = Number(remaining & BigInt(255));
    remaining = remaining / BigInt(256);
  }
}

export function buildStakeCtoIx(params: {
  owner: PublicKey;
  tokenMint: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { owner, tokenMint, tokenProgram, amount } = params;
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [userStake] = deriveUserStake(stakePool, owner);
  const [stakeVault] = deriveCtoStakeVault(stakePool);
  const ownerTokenAccount = getAssociatedTokenAddressSync(tokenMint, owner, false, tokenProgram);
  const data = Buffer.alloc(16);
  STAKE_CTO_DISCRIMINATOR.copy(data, 0);
  writeU64Le(data, amount, 8);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildUnstakeCtoIx(params: {
  owner: PublicKey;
  tokenMint: PublicKey;
  tokenProgram: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { owner, tokenMint, tokenProgram, amount } = params;
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [userStake] = deriveUserStake(stakePool, owner);
  const [stakeVault] = deriveCtoStakeVault(stakePool);
  const ownerTokenAccount = getAssociatedTokenAddressSync(tokenMint, owner, false, tokenProgram);
  const data = Buffer.alloc(16);
  UNSTAKE_CTO_DISCRIMINATOR.copy(data, 0);
  writeU64Le(data, amount, 8);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildClaimCtoStakingFeesIx(
  owner: PublicKey,
  tokenMint: PublicKey,
  tokenProgramX: PublicKey,
): TransactionInstruction {
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [userStake] = deriveUserStake(stakePool, owner);
  const [feeVaultX] = deriveCtoFeeVaultX(stakePool);
  const [feeVaultY] = deriveCtoFeeVaultY(stakePool);
  const ownerTokenAccount = getAssociatedTokenAddressSync(tokenMint, owner, false, tokenProgramX);
  const ownerWsolAccount = getAssociatedTokenAddressSync(WSOL_MINT, owner, false, TOKEN_PROGRAM_ID);

  return new TransactionInstruction({
    programId: HATCH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: stakePool, isSigner: false, isWritable: false },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: feeVaultX, isSigner: false, isWritable: true },
      { pubkey: feeVaultY, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: ownerWsolAccount, isSigner: false, isWritable: true },
      { pubkey: tokenProgramX, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLAIM_CTO_STAKING_FEES_DISCRIMINATOR,
  });
}
