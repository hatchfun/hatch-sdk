import { PublicKey } from "@solana/web3.js";
import { METEORA_DLMM_PROGRAM_ID } from "../constants/addresses";

export function deriveMeteoraPoolAccounts(
  lbPair: PublicKey,
  tokenMintX: PublicKey,
  tokenMintY: PublicKey,
): {
  reserveX: PublicKey;
  reserveY: PublicKey;
  oracle: PublicKey;
  binArrayBitmapExtension: PublicKey;
} {
  const [reserveX] = PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), tokenMintX.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );

  const [reserveY] = PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), tokenMintY.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );

  const [oracle] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), lbPair.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );

  const [binArrayBitmapExtension] = PublicKey.findProgramAddressSync(
    [Buffer.from("bitmap"), lbPair.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );

  return { reserveX, reserveY, oracle, binArrayBitmapExtension };
}

export function sortTokenMints(tokenX: PublicKey, tokenY: PublicKey): [PublicKey, PublicKey] {
  const comparison = tokenX.toBuffer().compare(tokenY.toBuffer());
  return comparison === 1 ? [tokenY, tokenX] : [tokenX, tokenY];
}

export function deriveLbPair(
  presetParameter: PublicKey,
  tokenMintX: PublicKey,
  tokenMintY: PublicKey,
): PublicKey {
  const [minKey, maxKey] = sortTokenMints(tokenMintX, tokenMintY);
  const [pda] = PublicKey.findProgramAddressSync(
    [presetParameter.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );
  return pda;
}
