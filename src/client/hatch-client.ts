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
 * then call `launch()`, `claimFees()`, `claimReferrerFees()`, or `getLaunchStatus()`.
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
   * with 70% of supply locked. Atomic single transaction.
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

    const instructions: TransactionInstruction[] = [];
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: this.config.launchComputeUnitLimit,
      }),
    );

    if (!launcherExists) {
      let referrerLauncherPda: PublicKey | undefined;
      if (params.referrer) {
        const [refPda] = deriveLauncherPda(params.referrer);
        referrerLauncherPda = refPda;
      }
      instructions.push(buildInitializeLauncherPdaIx(authority, referrerLauncherPda));
    }

    instructions.push(
      buildCreateTokenAndLaunchAccountIx(
        authority,
        tokenMintKeypair.publicKey,
        params.name,
        params.symbol,
        params.uri,
      ),
    );

    const launcherWsolAta = getAssociatedTokenAddressSync(
      WSOL_MINT,
      launcherPda,
      true,
      TOKEN_PROGRAM_ID,
    );
    const launcherWsolAtaInfo = await connection.getAccountInfo(launcherWsolAta);
    if (launcherWsolAtaInfo === null) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          authority,
          launcherWsolAta,
          launcherPda,
          WSOL_MINT,
          TOKEN_PROGRAM_ID,
        ),
      );
    }

    const poolResult = buildCreatePoolAndLockedPositionIx({
      authority,
      tokenMintX: tokenMintKeypair.publicKey,
      tokenMintY: WSOL_MINT,
      tokenProgramX: TOKEN_2022_PROGRAM_ID,
      tokenProgramY: TOKEN_PROGRAM_ID,
      position: positionKeypair.publicKey,
      presetParameter,
    });
    instructions.push(poolResult.instruction);

    const lookupTables = await fetchLookupTables(connection, GLOBAL_ALTS);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);

    const transaction = new VersionedTransaction(messageV0);

    if (params.dryRun) {
      return {
        signature: "",
        mint: tokenMintKeypair.publicKey,
        launcherPda,
        lbPair: poolResult.lbPair,
        position: positionKeypair.publicKey,
        transaction,
      };
    }

    transaction.sign([signer, tokenMintKeypair, positionKeypair]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight },
      "confirmed",
    );

    return {
      signature,
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
    for (const target of claimTargets) {
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
    }

    return { signatures, positionsClaimed: signatures.length };
  }

  /**
   * Sweep accumulated referrer earnings (from launches that used this wallet as referrer)
   * to the signer's WSOL ATA.
   */
  async claimReferrerFees(params: ClaimReferrerFeesParams = {}): Promise<ClaimReferrerFeesResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;

    const instructions: TransactionInstruction[] = [];

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
      return { signature: "" };
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
