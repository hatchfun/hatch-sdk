import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { HATCH_PROGRAM_ID, WSOL_MINT } from "../../constants/addresses";
import { deriveLauncherPda, deriveReferrerFeeAccount } from "../../pda";

const DISCRIMINATOR = Buffer.from([46, 243, 56, 145, 44, 82, 166, 125]);

export interface InitReferrerFeeAccountParams {
  authority: PublicKey;
}

/**
 * Build instruction to initialize the referrer fee account PDA.
 *
 * On-chain accounts (from init_referrer_fee_account.rs):
 *   0. authority            — signer, mut (payer)
 *   1. launcher_pda         — PDA ["launcher", authority]
 *   2. token_y_mint         — WSOL mint
 *   3. referrer_fee_account — PDA ["referrer_fees", launcher_pda], init
 *   4. token_program        — SPL Token
 *   5. system_program       — System
 */
export function buildInitReferrerFeeAccountIx(
  params: InitReferrerFeeAccountParams,
): TransactionInstruction {
  const { authority } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [referrerFeeAccount] = deriveReferrerFeeAccount(launcherPda);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: referrerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HATCH_PROGRAM_ID,
    data: DISCRIMINATOR,
  });
}
