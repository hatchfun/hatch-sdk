import DLMM from "@meteora-ag/dlmm";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { GLOBAL_ALTS, HATCH_TREASURY, WSOL_MINT } from "../constants";
import {
  buildClaimFeeManualIx,
  buildClaimReferrerFeesIx,
  buildInitPoolFeeAccountIx,
  buildInitReferrerFeeAccountIx,
} from "../fees";
import {
  buildCreatePoolAndLockedPositionIx,
  buildCreateTokenAndLaunchAccountIx,
  buildInitializeLauncherPdaIx,
} from "../launch";
import {
  deriveLauncherPda,
  derivePoolFeeAccount,
  deriveReferrerFeeAccount,
  launcherPdaExists,
  readLauncherPdaReferrer,
} from "../pda";
import { BONDING_CURVE_FEE_PRESETS, DEFAULT_BONDING_CURVE_FEE_RATE } from "./presets";
import type {
  ClaimFeesParams,
  ClaimFeesResult,
  ClaimReferrerFeesParams,
  ClaimReferrerFeesResult,
  HatchClientConfig,
  InitReferrerFeeAccountParams,
  InitReferrerFeeAccountResult,
  LaunchParams,
  LaunchResult,
  LaunchStatus,
} from "./types";

const DEFAULT_LAUNCH_CU_LIMIT = 1_200_000;
const DEFAULT_CLAIM_CU_LIMIT = 1_400_000;

/**
 * High-level client for Hatch token launches and fee claims.
 *
 * Designed for agents and scripts: instantiate once with a Connection + Keypair,
 * then call `launch()`, `claimFees()`, `initReferrerFeeAccount()`,
 * `claimReferrerFees()`, or `getLaunchStatus()`.
 *
 * For advanced composition (custom tx bundling, multi-signer flows), import the
 * individual `build*Ix` functions instead.
 */
export class HatchClient {
  private readonly config: Required<HatchClientConfig>;

  constructor(config: HatchClientConfig) {
    this.config = {
      launchComputeUnitLimit: DEFAULT_LAUNCH_CU_LIMIT,
      claimComputeUnitLimit: DEFAULT_CLAIM_CU_LIMIT,
      ...config,
    };
  }

  /**
   * Launch a new token: creates the Token-2022 mint with metadata, initializes
   * the LauncherPda (first launch only), and opens the pre-bonding DLMM position
   * with 70% of supply locked.
   *
   * Sent as up to two sequential transactions:
   *   1. Setup tx (only if needed) — initializes LauncherPda and/or the WSOL ATA
   *   2. Launch tx — creates the token mint and the pool/locked position
   *
   * The split keeps each tx under Solana's 1232-byte limit. On subsequent
   * launches from the same wallet, setup is skipped and only the launch tx is sent.
   *
   * Caller must host the metadata JSON at `params.uri` before calling.
   * Signer wallet needs ~0.25 SOL for rent + fees.
   */
  async launch(params: LaunchParams): Promise<LaunchResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;

    const tokenMintKeypair = Keypair.generate();
    const positionKeypair = Keypair.generate();
    const [launcherPda] = deriveLauncherPda(authority);

    const feeRate = params.feeRate ?? DEFAULT_BONDING_CURVE_FEE_RATE;
    const presetParameter = BONDING_CURVE_FEE_PRESETS[feeRate];

    const launcherExists = await launcherPdaExists(connection, authority);
    const launcherWsolAta = getAssociatedTokenAddressSync(
      WSOL_MINT,
      launcherPda,
      true,
      TOKEN_PROGRAM_ID,
    );
    const launcherWsolAtaInfo = await connection.getAccountInfo(launcherWsolAta);
    const needsSetup = !launcherExists || launcherWsolAtaInfo === null;

    const lookupTables = await fetchLookupTables(connection, GLOBAL_ALTS);

    // --- Setup tx (LauncherPda init + WSOL ATA) ---
    let setupTransaction: VersionedTransaction | undefined;
    let setupBlockhash: string | undefined;
    let setupLastValidBlockHeight: number | undefined;
    if (needsSetup) {
      const setupIxs: TransactionInstruction[] = [];
      if (!launcherExists) {
        let referrerLauncherPda: PublicKey | undefined;
        if (params.referrer) {
          const [refPda] = deriveLauncherPda(params.referrer);
          referrerLauncherPda = refPda;
        }
        setupIxs.push(buildInitializeLauncherPdaIx(authority, referrerLauncherPda));
      }
      if (launcherWsolAtaInfo === null) {
        setupIxs.push(
          createAssociatedTokenAccountInstruction(
            authority,
            launcherWsolAta,
            launcherPda,
            WSOL_MINT,
            TOKEN_PROGRAM_ID,
          ),
        );
      }
      const { blockhash: setupBh, lastValidBlockHeight: setupLvb } =
        await connection.getLatestBlockhash("confirmed");
      setupBlockhash = setupBh;
      setupLastValidBlockHeight = setupLvb;
      const setupMsg = new TransactionMessage({
        payerKey: authority,
        recentBlockhash: setupBh,
        instructions: setupIxs,
      }).compileToV0Message(lookupTables);
      setupTransaction = new VersionedTransaction(setupMsg);
    }

    // --- Launch tx (mint + pool + locked position) ---
    const launchIxs: TransactionInstruction[] = [];
    launchIxs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: this.config.launchComputeUnitLimit,
      }),
    );
    launchIxs.push(
      buildCreateTokenAndLaunchAccountIx(
        authority,
        tokenMintKeypair.publicKey,
        params.name,
        params.symbol,
        params.uri,
      ),
    );
    const poolResult = buildCreatePoolAndLockedPositionIx({
      authority,
      tokenMintX: tokenMintKeypair.publicKey,
      tokenMintY: WSOL_MINT,
      tokenProgramX: TOKEN_2022_PROGRAM_ID,
      tokenProgramY: TOKEN_PROGRAM_ID,
      position: positionKeypair.publicKey,
      presetParameter,
    });
    launchIxs.push(poolResult.instruction);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const launchMsg = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions: launchIxs,
    }).compileToV0Message(lookupTables);
    const transaction = new VersionedTransaction(launchMsg);

    if (params.dryRun) {
      transaction.sign([tokenMintKeypair, positionKeypair]);
      return {
        signature: "",
        mint: tokenMintKeypair.publicKey,
        launcherPda,
        lbPair: poolResult.lbPair,
        position: positionKeypair.publicKey,
        transaction,
        setupTransaction,
      };
    }

    // Send setup first (if needed) and wait for confirmation before launch.
    let setupSignature: string | undefined;
    if (setupTransaction) {
      setupTransaction.sign([signer]);
      setupSignature = await connection.sendTransaction(setupTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        {
          signature: setupSignature,
          blockhash: setupBlockhash!,
          lastValidBlockHeight: setupLastValidBlockHeight!,
        },
        "confirmed",
      );
    }

    transaction.sign([signer, tokenMintKeypair, positionKeypair]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    return {
      signature,
      setupSignature,
      mint: tokenMintKeypair.publicKey,
      launcherPda,
      lbPair: poolResult.lbPair,
      position: positionKeypair.publicKey,
    };
  }

  /**
   * Claim accrued WSOL fees for a launched token. 20% of WSOL goes to the Hatch
   * treasury (split 16%/4% if a referrer is set); the rest goes to the signer's
   * WSOL ATA. Token-side fees are burned on-chain.
   *
   * Resolves position(s) automatically from on-chain state. If multiple positions
   * exist for this mint, each is claimed in its own transaction.
   */
  async claimFees(params: ClaimFeesParams): Promise<ClaimFeesResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;
    const [launcherPda] = deriveLauncherPda(authority);

    const allPositions = await DLMM.getAllLbPairPositionsByUser(connection, launcherPda);
    const mintStr = params.mint.toBase58();

    const claimTargets: Array<{
      lbPair: PublicKey;
      position: PublicKey;
      tokenMintX: PublicKey;
      tokenMintY: PublicKey;
      tokenProgramX: PublicKey;
      tokenProgramY: PublicKey;
      minBinId: number;
      maxBinId: number;
    }> = [];

    for (const [lbPairStr, info] of Array.from(allPositions.entries())) {
      const tokenXMint = info.tokenX.publicKey;
      const tokenYMint = info.tokenY.publicKey;
      const launchedMint = tokenXMint.toBase58() === WSOL_MINT.toBase58() ? tokenYMint : tokenXMint;
      if (launchedMint.toBase58() !== mintStr) continue;

      for (const posData of info.lbPairPositionsData) {
        // Skip positions with no claimable WSOL fees. Wide empty positions (e.g. ones
        // spanning many bin arrays) require so many account metas that the resulting
        // claim tx overflows Solana's 1232-byte size limit even with ALTs, and the
        // throw aborts the whole loop — leaving non-empty positions unclaimed.
        const feeY = posData.positionData?.feeY?.toNumber?.() ?? 0;
        if (feeY <= 0) continue;

        claimTargets.push({
          lbPair: new PublicKey(lbPairStr),
          position: posData.publicKey,
          tokenMintX: tokenXMint,
          tokenMintY: tokenYMint,
          tokenProgramX: tokenXMint.equals(WSOL_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
          tokenProgramY: tokenYMint.equals(WSOL_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
          minBinId: posData.positionData.lowerBinId,
          maxBinId: posData.positionData.upperBinId,
        });
      }
    }

    if (claimTargets.length === 0) {
      throw new Error(
        `No claimable positions found for mint ${mintStr} under launcher ${launcherPda.toBase58()}`,
      );
    }

    const referrerLauncherPda = await readLauncherPdaReferrer(connection, authority);
    const referrerFeeAccount = referrerLauncherPda
      ? deriveReferrerFeeAccount(referrerLauncherPda)[0]
      : undefined;

    const signatures: string[] = [];
    const transactions: VersionedTransaction[] = [];
    const failures: Array<{ position: string; error: string }> = [];
    for (const target of claimTargets) {
      try {
        const instructions: TransactionInstruction[] = [];
        instructions.push(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: this.config.claimComputeUnitLimit,
          }),
        );

        const treasuryTokenY = getAssociatedTokenAddressSync(
          target.tokenMintY,
          HATCH_TREASURY,
          true,
          target.tokenProgramY,
        );
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            authority,
            treasuryTokenY,
            HATCH_TREASURY,
            target.tokenMintY,
            target.tokenProgramY,
          ),
        );

        const authorityTokenY = getAssociatedTokenAddressSync(
          target.tokenMintY,
          authority,
          false,
          target.tokenProgramY,
        );
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            authority,
            authorityTokenY,
            authority,
            target.tokenMintY,
            target.tokenProgramY,
          ),
        );

        const [poolFeeAccount] = derivePoolFeeAccount(launcherPda, target.lbPair);
        const poolFeeInfo = await connection.getAccountInfo(poolFeeAccount);
        if (poolFeeInfo === null) {
          instructions.push(
            buildInitPoolFeeAccountIx({
              authority,
              lbPair: target.lbPair,
              tokenMintY: target.tokenMintY,
              tokenProgramY: target.tokenProgramY,
            }),
          );
        }

        const { instruction } = buildClaimFeeManualIx({
          authority,
          lbPair: target.lbPair,
          position: target.position,
          tokenMintX: target.tokenMintX,
          tokenMintY: target.tokenMintY,
          tokenProgramX: target.tokenProgramX,
          tokenProgramY: target.tokenProgramY,
          minBinId: target.minBinId,
          maxBinId: target.maxBinId,
          referrerFeeAccount,
        });
        instructions.push(instruction);

        const lookupTables = await fetchLookupTables(connection, GLOBAL_ALTS);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

        const messageV0 = new TransactionMessage({
          payerKey: authority,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message(lookupTables);

        const transaction = new VersionedTransaction(messageV0);

        if (params.dryRun) {
          transactions.push(transaction);
          continue;
        }

        transaction.sign([signer]);
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 3,
        });
        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        signatures.push(signature);
      } catch (err) {
        // Don't let one bad position abort the rest of the claim loop. Wide positions
        // can produce txs that overflow Solana's 1232-byte size limit; surface the
        // error to the caller via `failures` and continue.
        failures.push({
          position: target.position.toBase58(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      signatures,
      positionsClaimed: claimTargets.length,
      failures: failures.length > 0 ? failures : undefined,
      transactions: params.dryRun ? transactions : undefined,
    };
  }

  /**
   * Initialize the caller's referrer fee account PDA.
   *
   * Referrers should do this once before referred launches start claiming fees,
   * otherwise the on-chain program falls back to sending the 4% referrer cut to
   * treasury when no referrer fee account exists.
   */
  async initReferrerFeeAccount(
    params: InitReferrerFeeAccountParams = {},
  ): Promise<InitReferrerFeeAccountResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;
    const [launcherPda] = deriveLauncherPda(authority);
    const [referrerFeeAccount] = deriveReferrerFeeAccount(launcherPda);

    const referrerFeeAccountInfo = await connection.getAccountInfo(referrerFeeAccount);
    if (referrerFeeAccountInfo !== null) {
      return { signature: "" };
    }

    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: authority,
        recentBlockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [buildInitReferrerFeeAccountIx({ authority })],
      }).compileToV0Message(),
    );

    if (params.dryRun) {
      return { signature: "", transaction };
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const liveTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: authority,
        recentBlockhash: blockhash,
        instructions: [buildInitReferrerFeeAccountIx({ authority })],
      }).compileToV0Message(),
    );
    liveTransaction.sign([signer]);
    const signature = await connection.sendTransaction(liveTransaction, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return { signature };
  }

  /**
   * Sweep accumulated referrer earnings (from launches that used this wallet as referrer)
   * to the signer's WSOL ATA.
   */
  async claimReferrerFees(params: ClaimReferrerFeesParams = {}): Promise<ClaimReferrerFeesResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;
    const [launcherPda] = deriveLauncherPda(authority);
    const [referrerFeeAccount] = deriveReferrerFeeAccount(launcherPda);

    const instructions: TransactionInstruction[] = [];

    const referrerFeeAccountInfo = await connection.getAccountInfo(referrerFeeAccount);
    if (referrerFeeAccountInfo === null) {
      instructions.push(buildInitReferrerFeeAccountIx({ authority }));
    }

    const authorityWsolAta = getAssociatedTokenAddressSync(
      WSOL_MINT,
      authority,
      false,
      TOKEN_PROGRAM_ID,
    );
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        authority,
        authorityWsolAta,
        authority,
        WSOL_MINT,
        TOKEN_PROGRAM_ID,
      ),
    );

    instructions.push(buildClaimReferrerFeesIx({ authority }));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);

    if (params.dryRun) {
      return { signature: "", transaction };
    }

    transaction.sign([signer]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    return { signature };
  }

  /**
   * Read on-chain status for a launched token: positions, claimable fees, active bin.
   */
  async getLaunchStatus(params: { mint: PublicKey }): Promise<LaunchStatus> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;
    const [launcherPda] = deriveLauncherPda(authority);

    const launcherInfo = await connection.getAccountInfo(launcherPda);
    const launcherExists = launcherInfo !== null;

    const mintStr = params.mint.toBase58();
    const allPositions = await DLMM.getAllLbPairPositionsByUser(connection, launcherPda);
    const matching: LaunchStatus["positions"] = [];

    for (const [lbPairStr, info] of Array.from(allPositions.entries())) {
      const tokenXMint = info.tokenX.publicKey;
      const tokenYMint = info.tokenY.publicKey;
      const launchedMint = tokenXMint.toBase58() === WSOL_MINT.toBase58() ? tokenYMint : tokenXMint;
      if (launchedMint.toBase58() !== mintStr) continue;

      for (const posData of info.lbPairPositionsData) {
        const feeY = posData.positionData?.feeY?.toNumber?.() ?? 0;
        const totalClaimed = posData.positionData?.totalClaimedFeeYAmount?.toNumber?.() ?? 0;
        matching.push({
          position: posData.publicKey,
          lbPair: new PublicKey(lbPairStr),
          claimableSol: (feeY * 0.8) / 1e9,
          allTimeFeeSol: ((feeY + totalClaimed) * 0.8) / 1e9,
          activeBinId: Number(info.lbPair.activeId),
        });
      }
    }

    const totalClaimableSol = matching.reduce((sum, p) => sum + p.claimableSol, 0);

    return {
      mint: params.mint,
      launcherPda,
      launcherExists,
      positions: matching,
      totalClaimableSol,
    };
  }
}

async function fetchLookupTables(
  connection: import("@solana/web3.js").Connection,
  addresses: PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  const results = await Promise.all(
    addresses.map((addr) => connection.getAddressLookupTable(addr)),
  );
  return results
    .map((r) => r.value)
    .filter((v): v is AddressLookupTableAccount => v !== null);
}
