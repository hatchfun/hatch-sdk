import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { HATCH_PROGRAM_ID, WSOL_MINT } from "../../constants/addresses";
import { deriveLauncherPda, deriveReferrerFeeAccount } from "../../pda";

const DISCRIMINATOR = Buffer.from([174, 198, 187, 0, 99, 225, 207, 120]);

export interface ClaimReferrerFeesParams {
  authority: PublicKey;
}

/**
 * Build instruction to sweep accumulated referrer fees to the authority's WSOL ATA.
 *
 * On-chain accounts (from claim_referrer_fees.rs):
 *   0. authority            — signer, mut
 *   1. launcher_pda         — PDA ["launcher", authority]
 *   2. referrer_fee_account — PDA ["referrer_fees", launcher_pda], mut
 *   3. authority_token_y    — authority's WSOL ATA, mut
 *   4. token_y_mint         — WSOL mint
 *   5. token_program        — SPL Token
 */
export function buildClaimReferrerFeesIx(
  params: ClaimReferrerFeesParams,
): TransactionInstruction {
  const { authority } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [referrerFeeAccount] = deriveReferrerFeeAccount(launcherPda);
  const authorityTokenY = getAssociatedTokenAddressSync(
    WSOL_MINT,
    authority,
    false,
    TOKEN_PROGRAM_ID,
  );

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: referrerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: authorityTokenY, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: HATCH_PROGRAM_ID,
    data: DISCRIMINATOR,
  });
}
