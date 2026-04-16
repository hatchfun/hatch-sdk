import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { HATCH_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../../constants/addresses";
import { deriveLauncherPda, deriveLaunchTokenAccount } from "../../pda";

function serializeBorshString(str: string): Buffer {
  const bytes = Buffer.from(str, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

const DISCRIMINATOR = Buffer.from([12, 93, 251, 247, 85, 70, 76, 132]);

export function buildCreateTokenAndLaunchAccountIx(
  authority: PublicKey,
  tokenMint: PublicKey,
  name: string,
  symbol: string,
  uri: string,
): TransactionInstruction {
  const [launcherPda] = deriveLauncherPda(authority);
  const [launchTokenAccount] = deriveLaunchTokenAccount(tokenMint, launcherPda);
  const data = Buffer.concat([
    DISCRIMINATOR,
    serializeBorshString(name),
    serializeBorshString(symbol),
    serializeBorshString(uri),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: launcherPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: true, isWritable: true },
      { pubkey: launchTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: HATCH_PROGRAM_ID,
    data,
  });
}
