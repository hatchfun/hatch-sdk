import { PublicKey } from "@solana/web3.js";

export const HATCH_PROGRAM_ID = new PublicKey("CDrrVT552hU9Zy2rEripvssmL2tD2bvoNbjDunb9Px83");

export const METEORA_DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const NATIVE_SOL_MINT = new PublicKey("11111111111111111111111111111111");
export const HATCH_TREASURY = new PublicKey("85FXCaLWrmU2LeQgL5gucWvaovWAB9HauykdsDAQJNLm");

export const LAUNCHER_PDA_SEED = Buffer.from("launcher");
export const LAUNCH_TOKEN_ACCOUNT_SEED = Buffer.from("launch-token");
export const POOL_FEES_SEED = Buffer.from("pool_fees");
export const METEORA_EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");

export const REFERRER_FEE_SEED = Buffer.from("referrer_fees");

/** Byte offset of the `referrer` Pubkey in a LauncherPda account.
 *  Layout: 8 (discriminator) + 32 (authority) + 1 (bump) = 41 */
export const LAUNCHER_PDA_REFERRER_OFFSET = 41;
