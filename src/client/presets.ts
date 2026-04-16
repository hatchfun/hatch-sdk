import { PublicKey } from "@solana/web3.js";

/**
 * Bonding curve fee rate presets (on-chain Meteora DLMM preset parameter PDAs).
 *
 * These control the pool's base fee tier. The on-chain program supports three options;
 * the default matches the Hatch web app's default ("1.00").
 */
export const BONDING_CURVE_FEE_PRESETS = {
  "1.00": new PublicKey("Ak1mPM231mXP9e7GKNBdoSpyZRQ5nSpWuA2LH5xZKop2"),
  "2.00": new PublicKey("4DovFrjtP9FhbFwhXqubSba2WMjd45G5iRTE95YyyCkJ"),
  "5.00": new PublicKey("7pz5PW7scE1kZ1FPMDrfpRomD1nUfs3g14nk9Vbjyypq"),
} as const;

export type BondingCurveFeeRate = keyof typeof BONDING_CURVE_FEE_PRESETS;

export const DEFAULT_BONDING_CURVE_FEE_RATE: BondingCurveFeeRate = "1.00";
