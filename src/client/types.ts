import type {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import type { BondingCurveFeeRate } from "./presets";

export interface HatchClientConfig {
  /** Solana RPC connection. */
  connection: Connection;
  /** Keypair that signs and pays for transactions. */
  signer: Keypair;
  /** Optional compute unit limit override for `launch()`. Defaults to 1,200,000. */
  launchComputeUnitLimit?: number;
  /** Optional compute unit limit override for `claimFees()`. Defaults to 1,400,000. */
  claimComputeUnitLimit?: number;
}

export interface LaunchParams {
  /** Token name (stored in Token-2022 metadata). */
  name: string;
  /** Token symbol / ticker. */
  symbol: string;
  /** Publicly-reachable HTTPS URL to a JSON metadata file.
   *
   *  Expected JSON shape:
   *  ```json
   *  {
   *    "name": "My Token",
   *    "symbol": "MYTOK",
   *    "description": "Optional description",
   *    "image": "https://example.com/logo.png"
   *  }
   *  ```
   */
  uri: string;
  /** Optional referrer wallet pubkey. Immutably recorded on the LauncherPda on first launch. */
  referrer?: PublicKey;
  /** Bonding curve fee rate. Defaults to "1.00". */
  feeRate?: BondingCurveFeeRate;
  /** If true, build the transaction but do not send. Returns the unsigned VersionedTransaction. */
  dryRun?: boolean;
}

export interface LaunchResult {
  /** The main launch transaction signature (empty string if dryRun). */
  signature: string;
  /** Optional setup-tx signature, if LauncherPda and/or WSOL ATA had to be created first.
   *  The setup step is sent before the launch tx when needed, to keep each tx under the 1232-byte limit. */
  setupSignature?: string;
  /** The newly-created SPL token mint pubkey. */
  mint: PublicKey;
  /** The LauncherPda that owns the position (derived from signer). */
  launcherPda: PublicKey;
  /** The DLMM pool (lbPair) address. */
  lbPair: PublicKey;
  /** The locked Meteora position pubkey. */
  position: PublicKey;
  /** The launch transaction, pre-signed by any SDK-generated ephemeral signers when dryRun is true. */
  transaction?: VersionedTransaction;
  /** The setup transaction (populated when dryRun is true and setup is needed). */
  setupTransaction?: VersionedTransaction;
}

export interface ClaimFeesParams {
  /** The launched token mint. The SDK resolves the associated position(s) automatically. */
  mint: PublicKey;
  /** If true, build the transaction but do not send. */
  dryRun?: boolean;
}

export interface ClaimFeesResult {
  /** Transaction signatures (one per claimed position). */
  signatures: string[];
  /** Number of positions targeted in this call. */
  positionsClaimed: number;
  /** Built claim transactions when dryRun is true. */
  transactions?: VersionedTransaction[];
}

export interface InitReferrerFeeAccountParams {
  /** If true, build the transaction but do not send. */
  dryRun?: boolean;
}

export interface InitReferrerFeeAccountResult {
  signature: string;
  /** The built init transaction when dryRun is true. */
  transaction?: VersionedTransaction;
}

export interface ClaimReferrerFeesParams {
  /** If true, build the transaction but do not send. */
  dryRun?: boolean;
}

export interface ClaimReferrerFeesResult {
  signature: string;
  /** The built claim transaction when dryRun is true. */
  transaction?: VersionedTransaction;
}

export interface LaunchStatus {
  mint: PublicKey;
  launcherPda: PublicKey;
  /** True if the LauncherPda account exists on-chain. */
  launcherExists: boolean;
  /** Positions owned by the LauncherPda for this mint, with claimable SOL. */
  positions: Array<{
    position: PublicKey;
    lbPair: PublicKey;
    claimableSol: number;
    allTimeFeeSol: number;
    activeBinId: number;
  }>;
  /** Aggregate claimable SOL across all positions for this mint. */
  totalClaimableSol: number;
}
