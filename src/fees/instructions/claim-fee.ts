import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  HATCH_PROGRAM_ID,
  HATCH_TREASURY,
  MEMO_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID,
  WSOL_MINT,
} from "../../constants/addresses";
import { findMeteoraClaimTickArrays } from "../../meteora";
import { deriveMeteoraPoolAccounts } from "../../meteora";
import {
  deriveCtoFeeVaultX,
  deriveCtoFeeVaultY,
  deriveCtoStakePool,
  deriveLaunchTokenAccount,
  deriveLaunchState,
  deriveLauncherPda,
  deriveMeteorEventAuthority,
  derivePoolFeeAccount,
} from "../../pda";
import { getInstructionDiscriminator } from "../../utils/discriminator";
import { buildMeteoraRemainingAccountsInfo } from "../../utils/remaining-accounts";

const DISCRIMINATOR = getInstructionDiscriminator("claim_fee");
const CTO_DISCRIMINATOR = getInstructionDiscriminator("claim_fee_cto");

export interface ClaimFeeParams {
  authority: PublicKey;
  launcherPda?: PublicKey;
  lbPair: PublicKey;
  position: PublicKey;
  tokenMintX: PublicKey;
  tokenMintY: PublicKey;
  tokenProgramX: PublicKey;
  tokenProgramY: PublicKey;
  minBinId: number;
  maxBinId: number;
  includeCtoAccounts?: boolean;
}

export function buildClaimFeeIx(params: ClaimFeeParams): {
  instruction: TransactionInstruction;
  binArrays: PublicKey[];
} {
  const {
    authority,
    launcherPda: launcherPdaOverride,
    lbPair,
    position,
    tokenMintX,
    tokenMintY,
    tokenProgramX,
    tokenProgramY,
    minBinId,
    maxBinId,
    includeCtoAccounts,
  } = params;

  const launcherPda = launcherPdaOverride ?? deriveLauncherPda(authority)[0];
  const { reserveX, reserveY } = deriveMeteoraPoolAccounts(lbPair, tokenMintX, tokenMintY);
  const eventAuthority = deriveMeteorEventAuthority()[0];
  const [poolFeeAccountY] = derivePoolFeeAccount(launcherPda, lbPair);
  const [launchState] = deriveLaunchState(tokenMintX);
  const [ctoStakePool] = deriveCtoStakePool(launchState);
  const [ctoFeeVaultX] = deriveCtoFeeVaultX(ctoStakePool);
  const [ctoFeeVaultY] = deriveCtoFeeVaultY(ctoStakePool);

  const isTokenXWsol = tokenMintX.equals(WSOL_MINT);
  const userTokenX = isTokenXWsol
    ? getAssociatedTokenAddressSync(tokenMintX, launcherPda, true, tokenProgramX)
    : deriveLaunchTokenAccount(tokenMintX, launcherPda)[0];

  const treasuryTokenY = getAssociatedTokenAddressSync(
    tokenMintY,
    HATCH_TREASURY,
    true,
    tokenProgramY,
  );

  const binArrays = findMeteoraClaimTickArrays(lbPair, minBinId, maxBinId);
  const remainingAccountsInfo = buildMeteoraRemainingAccountsInfo();
  const discriminator = includeCtoAccounts ? CTO_DISCRIMINATOR : DISCRIMINATOR;
  const data = Buffer.concat([
    discriminator,
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.alloc(4),
    remainingAccountsInfo,
  ]);

  data.writeInt32LE(minBinId, 8);
  data.writeInt32LE(maxBinId, 12);
  data.writeUInt32LE(remainingAccountsInfo.length, 16);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: launcherPda, isSigner: false, isWritable: false },
    { pubkey: lbPair, isSigner: false, isWritable: true },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: reserveX, isSigner: false, isWritable: true },
    { pubkey: reserveY, isSigner: false, isWritable: true },
    { pubkey: userTokenX, isSigner: false, isWritable: true },
    { pubkey: poolFeeAccountY, isSigner: false, isWritable: true },
    { pubkey: treasuryTokenY, isSigner: false, isWritable: true },
    { pubkey: tokenMintX, isSigner: false, isWritable: true },
    { pubkey: tokenMintY, isSigner: false, isWritable: false },
    { pubkey: tokenProgramX, isSigner: false, isWritable: false },
    { pubkey: tokenProgramY, isSigner: false, isWritable: false },
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: launchState, isSigner: false, isWritable: true },
  ];

  for (const binArray of binArrays) {
    keys.push({ pubkey: binArray, isSigner: false, isWritable: true });
  }
  if (includeCtoAccounts) {
    keys.push({ pubkey: ctoStakePool, isSigner: false, isWritable: true });
    keys.push({ pubkey: ctoFeeVaultX, isSigner: false, isWritable: true });
    keys.push({ pubkey: ctoFeeVaultY, isSigner: false, isWritable: true });
  }

  return {
    instruction: new TransactionInstruction({
      programId: HATCH_PROGRAM_ID,
      keys,
      data,
    }),
    binArrays,
  };
}
