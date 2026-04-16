import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  HATCH_PROGRAM_ID,
  HATCH_TREASURY,
  MEMO_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID,
  METEORA_EVENT_AUTHORITY_SEED,
  WSOL_MINT,
} from "../../constants/addresses";
import { findMeteoraClaimTickArrays } from "../../meteora";
import { deriveMeteoraPoolAccounts } from "../../meteora";
import { deriveLaunchTokenAccount, deriveLauncherPda, derivePoolFeeAccount } from "../../pda";

const DISCRIMINATOR = Buffer.from([235, 20, 122, 16, 218, 176, 163, 76]);

export interface ClaimFeeManualParams {
  authority: PublicKey;
  lbPair: PublicKey;
  position: PublicKey;
  tokenMintX: PublicKey;
  tokenMintY: PublicKey;
  tokenProgramX: PublicKey;
  tokenProgramY: PublicKey;
  minBinId: number;
  maxBinId: number;
  /** Optional: referrer fee account PDA. If provided, appended as the last remaining account
   *  after bin arrays so the on-chain program can split 16% treasury / 4% referrer. */
  referrerFeeAccount?: PublicKey;
}

export function buildClaimFeeManualIx(params: ClaimFeeManualParams): {
  instruction: TransactionInstruction;
  binArrays: PublicKey[];
} {
  const {
    authority,
    lbPair,
    position,
    tokenMintX,
    tokenMintY,
    tokenProgramX,
    tokenProgramY,
    minBinId,
    maxBinId,
  } = params;

  const [launcherPda] = deriveLauncherPda(authority);
  const { reserveX, reserveY } = deriveMeteoraPoolAccounts(lbPair, tokenMintX, tokenMintY);

  const isTokenXWsol = tokenMintX.equals(WSOL_MINT);
  const userTokenX = isTokenXWsol
    ? getAssociatedTokenAddressSync(tokenMintX, launcherPda, true, tokenProgramX)
    : deriveLaunchTokenAccount(tokenMintX, launcherPda)[0];

  const [poolFeeAccountY] = derivePoolFeeAccount(launcherPda, lbPair);
  const treasuryTokenY = getAssociatedTokenAddressSync(
    tokenMintY,
    HATCH_TREASURY,
    true,
    tokenProgramY,
  );
  const authorityTokenY = getAssociatedTokenAddressSync(
    tokenMintY,
    authority,
    false,
    tokenProgramY,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [METEORA_EVENT_AUTHORITY_SEED],
    METEORA_DLMM_PROGRAM_ID,
  );
  const binArrays = findMeteoraClaimTickArrays(lbPair, minBinId, maxBinId);

  const remainingAccountsInfo = Buffer.from([
    0x02, 0x00, 0x00,
    0x00, 0x00,
    0x00, 0x01,
    0x00,
  ]);

  const data = Buffer.concat([
    DISCRIMINATOR,
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.alloc(4),
    remainingAccountsInfo,
  ]);
  data.writeInt32LE(minBinId, 8);
  data.writeInt32LE(maxBinId, 12);
  data.writeUInt32LE(remainingAccountsInfo.length, 16);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: launcherPda, isSigner: false, isWritable: false },
    { pubkey: lbPair, isSigner: false, isWritable: true },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: reserveX, isSigner: false, isWritable: true },
    { pubkey: reserveY, isSigner: false, isWritable: true },
    { pubkey: userTokenX, isSigner: false, isWritable: true },
    { pubkey: poolFeeAccountY, isSigner: false, isWritable: true },
    { pubkey: treasuryTokenY, isSigner: false, isWritable: true },
    { pubkey: authorityTokenY, isSigner: false, isWritable: true },
    { pubkey: tokenMintX, isSigner: false, isWritable: true },
    { pubkey: tokenMintY, isSigner: false, isWritable: false },
    { pubkey: tokenProgramX, isSigner: false, isWritable: false },
    { pubkey: tokenProgramY, isSigner: false, isWritable: false },
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  for (const binArray of binArrays) {
    keys.push({ pubkey: binArray, isSigner: false, isWritable: true });
  }

  // Referrer fee account must be the LAST remaining account (after bin arrays).
  // The on-chain program's find_referrer_fee_account() checks the last entry.
  if (params.referrerFeeAccount) {
    keys.push({ pubkey: params.referrerFeeAccount, isSigner: false, isWritable: true });
  }

  return {
    instruction: new TransactionInstruction({
      keys,
      programId: HATCH_PROGRAM_ID,
      data,
    }),
    binArrays,
  };
}
