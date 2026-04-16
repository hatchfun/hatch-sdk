import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey } from "@solana/web3.js";

export interface LaunchPresetParameter {
  publicKey: PublicKey;
  binStep: number;
}

export async function getLaunchPresetParameter(
  connection: Connection,
  preferredBinStep: number,
  preferredBaseFee: number,
): Promise<LaunchPresetParameter> {
  const { presetParameter2 } = await DLMM.getAllPresetParameters(connection);

  const presetsWithFee = presetParameter2.map((param) => {
    const { baseFactor, binStep, baseFeePowerFactor } = param.account;
    const baseFee = (baseFactor * binStep * 10 * Math.pow(10, baseFeePowerFactor)) / 10000000;
    return { ...param, baseFee };
  });

  let matching = presetsWithFee.find(
    (preset) =>
      preset.account.binStep === preferredBinStep &&
      Math.abs(preset.baseFee - preferredBaseFee) < 0.0001,
  );

  if (!matching) {
    matching = presetsWithFee.find((preset) => preset.account.binStep === preferredBinStep);
  }

  if (!matching && presetsWithFee.length > 0) {
    matching = presetsWithFee[0];
  }

  if (!matching) {
    throw new Error("No preset parameters available");
  }

  return {
    publicKey: matching.publicKey,
    binStep: matching.account.binStep,
  };
}
