import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { METEORA_DLMM_PROGRAM_ID } from "../constants/addresses";

export function binIdToBinArrayIndex(binId: BN): BN {
  const maxBinArraySize = new BN(70);
  const { div: idx, mod } = binId.divmod(maxBinArraySize);
  return binId.isNeg() && !mod.isZero() ? idx.sub(new BN(1)) : idx;
}

export function deriveBinArray(lbPair: PublicKey, index: BN): PublicKey {
  let binArrayBytes: Uint8Array;
  if (index.isNeg()) {
    binArrayBytes = new Uint8Array(index.toTwos(64).toArrayLike(Buffer, "le", 8));
  } else {
    binArrayBytes = new Uint8Array(index.toArrayLike(Buffer, "le", 8));
  }

  const [binArray] = PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array"), lbPair.toBuffer(), binArrayBytes],
    METEORA_DLMM_PROGRAM_ID,
  );

  return binArray;
}

export function findMeteoraTickArrays(
  lbPair: PublicKey,
  lowerBinId: number,
  upperBinId: number,
): PublicKey[] {
  const indicesSet = new Set<string>();
  for (let binId = lowerBinId; binId <= upperBinId; binId++) {
    indicesSet.add(binIdToBinArrayIndex(new BN(binId)).toString());
  }

  const indices = Array.from(indicesSet)
    .map((idx) => new BN(idx))
    .sort((a, b) => a.cmp(b));

  const tickArrays = indices.map((index) => deriveBinArray(lbPair, index));
  const tickArrayUpperIndex = indices[indices.length - 1].add(new BN(1));
  tickArrays.push(deriveBinArray(lbPair, tickArrayUpperIndex));

  return tickArrays;
}

export function findMeteoraClaimTickArrays(
  lbPair: PublicKey,
  lowerBinId: number,
  upperBinId: number,
): PublicKey[] {
  const indicesSet = new Set<string>();
  for (let binId = lowerBinId; binId <= upperBinId; binId++) {
    indicesSet.add(binIdToBinArrayIndex(new BN(binId)).toString());
  }

  const indices = Array.from(indicesSet)
    .map((idx) => new BN(idx))
    .sort((a, b) => a.cmp(b));

  return indices.map((index) => deriveBinArray(lbPair, index));
}
