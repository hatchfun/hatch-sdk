import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { HATCH_PROGRAM_ID } from "../../constants/addresses";
import { deriveLauncherPda, derivePoolFeeAccount } from "../../pda";

const DISCRIMINATOR = Buffer.from([4, 189, 198, 225, 146, 52, 38, 225]);

export interface InitPoolFeeAccountParams {
  authority: PublicKey;
  lbPair: PublicKey;
  tokenMintY: PublicKey;
  tokenProgramY: PublicKey;
}

export function buildInitPoolFeeAccountIx(params: InitPoolFeeAccountParams): TransactionInstruction {
  const { authority, lbPair, tokenMintY, tokenProgramY } = params;
  const [launcherPda] = deriveLauncherPda(authority);
  const [poolFeeAccountY] = derivePoolFeeAccount(launcherPda, lbPair);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: lbPair, isSigner: false, isWritable: false },
      { pubkey: tokenMintY, isSigner: false, isWritable: false },
      { pubkey: poolFeeAccountY, isSigner: false, isWritable: true },
      { pubkey: tokenProgramY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HATCH_PROGRAM_ID,
    data: DISCRIMINATOR,
  });
}
