import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  HATCH_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID,
  METEORA_EVENT_AUTHORITY_SEED,
} from "../../constants/addresses";
import { findMeteoraTickArrays } from "../../meteora";
import { deriveLbPair, deriveMeteoraPoolAccounts } from "../../meteora";
import {
  deriveLaunchState,
  deriveLauncherPda,
  deriveLaunchTokenAccount,
  derivePoolFeeAccount,
} from "../../pda";

const DISCRIMINATOR = Buffer.from([140, 164, 125, 74, 166, 59, 206, 48]);

export interface CreatePoolAndLockedPositionParams {
  authority: PublicKey;
  tokenMintX: PublicKey;
  tokenMintY: PublicKey;
  tokenProgramX: PublicKey;
  tokenProgramY: PublicKey;
  position: PublicKey;
  presetParameter: PublicKey;
}

const PREBONDING_LOWER_BIN_ID = -444;
const PREBONDING_UPPER_BIN_ID = -375;

export function buildCreatePoolAndLockedPositionIx(params: CreatePoolAndLockedPositionParams): {
  instruction: TransactionInstruction;
  lbPair: PublicKey;
  binArrays: PublicKey[];
} {
  const {
    authority,
    tokenMintX,
    tokenMintY,
    tokenProgramX,
    tokenProgramY,
    position,
    presetParameter,
  } = params;

  const [launcherPda] = deriveLauncherPda(authority);
  const lbPair = deriveLbPair(presetParameter, tokenMintX, tokenMintY);
  const { reserveX, reserveY, oracle, binArrayBitmapExtension } = deriveMeteoraPoolAccounts(
    lbPair,
    tokenMintX,
    tokenMintY,
  );
  const [launchTokenAccount] = deriveLaunchTokenAccount(tokenMintX, launcherPda);
  const [launchState] = deriveLaunchState(tokenMintX);
  const userTokenY = getAssociatedTokenAddressSync(tokenMintY, launcherPda, true, tokenProgramY);
  const [poolFeeAccount] = derivePoolFeeAccount(launcherPda, lbPair);
  const binArrays = findMeteoraTickArrays(lbPair, PREBONDING_LOWER_BIN_ID, PREBONDING_UPPER_BIN_ID);
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [METEORA_EVENT_AUTHORITY_SEED],
    METEORA_DLMM_PROGRAM_ID,
  );

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: launcherPda, isSigner: false, isWritable: true },
    { pubkey: lbPair, isSigner: false, isWritable: true },
    { pubkey: reserveX, isSigner: false, isWritable: true },
    { pubkey: reserveY, isSigner: false, isWritable: true },
    { pubkey: oracle, isSigner: false, isWritable: true },
    { pubkey: presetParameter, isSigner: false, isWritable: false },
    { pubkey: tokenMintX, isSigner: false, isWritable: false },
    { pubkey: tokenMintY, isSigner: false, isWritable: false },
    { pubkey: launchTokenAccount, isSigner: false, isWritable: true },
    { pubkey: launchState, isSigner: false, isWritable: false },
    { pubkey: userTokenY, isSigner: false, isWritable: true },
    { pubkey: poolFeeAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: position, isSigner: true, isWritable: true },
    { pubkey: binArrayBitmapExtension, isSigner: false, isWritable: true },
    { pubkey: tokenProgramX, isSigner: false, isWritable: false },
    { pubkey: tokenProgramY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  for (const binArray of binArrays) {
    keys.push({ pubkey: binArray, isSigner: false, isWritable: true });
  }

  return {
    instruction: new TransactionInstruction({
      keys,
      programId: HATCH_PROGRAM_ID,
      data: DISCRIMINATOR,
    }),
    lbPair,
    binArrays,
  };
}
