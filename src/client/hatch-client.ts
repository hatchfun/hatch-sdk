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
import {
  GLOBAL_ALTS,
  HATCH_TREASURY,
  LAUNCH_MODE_CTO,
  LAUNCH_MODE_NORMAL,
  WSOL_MINT,
} from "../constants";
import {
  buildClaimFeeManualIx,
  buildClaimReferrerFeesIx,
  buildInitPoolFeeAccountIx,
  buildInitReferrerFeeAccountIx,
} from "../fees";
import {
  buildCreatePoolAndLockedPositionIx,
  buildCreateTokenAndLaunchAccountIx,
  buildInitializeCtoFeeVaultXIx,
  buildInitializeCtoFeeVaultYIx,
  buildInitializeCtoStakePoolIx,
  buildInitializeLaunchStateIx,
  buildInitializeLauncherPdaIx,
} from "../launch";
import {
  deriveCtoStakePool,
  deriveLaunchState,
  deriveLauncherPda,
  derivePoolFeeAccount,
  deriveReferrerFeeAccount,
  deriveUserStake,
  launcherPdaExists,
  readLauncherPdaReferrer,
} from "../pda";
import {
  buildClaimCtoStakingFeesIx,
  buildStakeCtoIx,
  buildUnstakeCtoIx,
} from "../staking";
import { BONDING_CURVE_FEE_PRESETS, DEFAULT_BONDING_CURVE_FEE_RATE } from "./presets";
import type {
  ClaimCtoStakingFeesParams,
  ClaimFeesParams,
  ClaimFeesResult,
  ClaimReferrerFeesParams,
  ClaimReferrerFeesResult,
  CtoStakeParams,
  CtoStakingActionResult,
  CtoStakingStatus,
  CtoUnstakeParams,
  GetCtoStakingStatusParams,
  HatchClientConfig,
  InitReferrerFeeAccountParams,
  InitReferrerFeeAccountResult,
  LaunchParams,
  LaunchResult,
  LaunchStatus,
} from "./types";

const DEFAULT_LAUNCH_CU_LIMIT = 1_200_000;
const DEFAULT_CLAIM_CU_LIMIT = 1_400_000;
const DEFAULT_CTO_STAKING_CU_LIMIT = 200_000;
const LAUNCH_STATE_MODE_OFFSET = 72;
const STAKE_POOL_TOTAL_STAKED_OFFSET = 200;
const STAKE_POOL_ACC_FEE_X_PER_SHARE_OFFSET = 208;
const STAKE_POOL_ACC_FEE_Y_PER_SHARE_OFFSET = 240;
const USER_STAKE_AMOUNT_OFFSET = 72;
const USER_STAKE_FEE_DEBT_X_OFFSET = 80;
const USER_STAKE_PENDING_X_OFFSET = 96;
const USER_STAKE_FEE_DEBT_Y_OFFSET = 104;
const USER_STAKE_PENDING_Y_OFFSET = 120;
const CTO_REWARD_SCALE = BigInt("1000000000000000000");

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
      ctoStakingComputeUnitLimit: DEFAULT_CTO_STAKING_CU_LIMIT,
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
    const launchMode = params.launchMode ?? LAUNCH_MODE_NORMAL;
    const isCtoLaunch = launchMode === LAUNCH_MODE_CTO;

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

    // --- Token setup tx/segment (mint + launch state + optional CTO staking accounts) ---
    const tokenSetupIxs: TransactionInstruction[] = [];
    tokenSetupIxs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: this.config.launchComputeUnitLimit,
      }),
    );
    tokenSetupIxs.push(
      buildCreateTokenAndLaunchAccountIx(
        authority,
        tokenMintKeypair.publicKey,
        params.name,
        params.symbol,
        params.uri,
      ),
    );
    tokenSetupIxs.push(
      buildInitializeLaunchStateIx(authority, tokenMintKeypair.publicKey, launchMode),
    );
    if (isCtoLaunch) {
      tokenSetupIxs.push(
        buildInitializeCtoStakePoolIx({
          authority,
          tokenMint: tokenMintKeypair.publicKey,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
        }),
      );
      tokenSetupIxs.push(
        buildInitializeCtoFeeVaultXIx({
          authority,
          tokenMint: tokenMintKeypair.publicKey,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
        }),
      );
      tokenSetupIxs.push(
        buildInitializeCtoFeeVaultYIx({
          authority,
          tokenMint: tokenMintKeypair.publicKey,
        }),
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
      launchMode,
    });

    const launchIxs = isCtoLaunch
      ? [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: this.config.launchComputeUnitLimit,
          }),
          poolResult.instruction,
        ]
      : [...tokenSetupIxs, poolResult.instruction];

    let ctoSetupTransaction: VersionedTransaction | undefined;
    let ctoSetupBlockhash: string | undefined;
    let ctoSetupLastValidBlockHeight: number | undefined;
    if (isCtoLaunch) {
      const { blockhash: ctoSetupBh, lastValidBlockHeight: ctoSetupLvb } =
        await connection.getLatestBlockhash("confirmed");
      ctoSetupBlockhash = ctoSetupBh;
      ctoSetupLastValidBlockHeight = ctoSetupLvb;
      const ctoSetupMsg = new TransactionMessage({
        payerKey: authority,
        recentBlockhash: ctoSetupBh,
        instructions: tokenSetupIxs,
      }).compileToV0Message(lookupTables);
      ctoSetupTransaction = new VersionedTransaction(ctoSetupMsg);
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const launchMsg = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions: launchIxs,
    }).compileToV0Message(lookupTables);
    const transaction = new VersionedTransaction(launchMsg);

    if (params.dryRun) {
      if (ctoSetupTransaction) {
        ctoSetupTransaction.sign([tokenMintKeypair]);
        transaction.sign([positionKeypair]);
      } else {
        transaction.sign([tokenMintKeypair, positionKeypair]);
      }
      return {
        signature: "",
        mint: tokenMintKeypair.publicKey,
        launcherPda,
        lbPair: poolResult.lbPair,
        position: positionKeypair.publicKey,
        transaction,
        setupTransaction,
        ctoSetupTransaction,
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

    let ctoSetupSignature: string | undefined;
    if (ctoSetupTransaction) {
      ctoSetupTransaction.sign([signer, tokenMintKeypair]);
      ctoSetupSignature = await connection.sendTransaction(ctoSetupTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        {
          signature: ctoSetupSignature,
          blockhash: ctoSetupBlockhash!,
          lastValidBlockHeight: ctoSetupLastValidBlockHeight!,
        },
        "confirmed",
      );
    }

    transaction.sign(
      ctoSetupTransaction
        ? [signer, positionKeypair]
        : [signer, tokenMintKeypair, positionKeypair],
    );
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
      ctoSetupSignature,
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
    const isCtoMint = (await readLaunchMode(connection, params.mint)) === LAUNCH_MODE_CTO;

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
        // Skip positions with no claimable fees. Wide empty positions (e.g. ones
        // spanning many bin arrays) require so many account metas that the resulting
        // claim tx overflows Solana's 1232-byte size limit even with ALTs. Normal
        // mode only pays WSOL feeY to the launcher; CTO mode also distributes
        // token-X fees to stakers.
        const hasFeeY = amountIsPositive(posData.positionData?.feeY);
        const hasFeeX = amountIsPositive(posData.positionData?.feeX);
        if (isCtoMint ? !hasFeeY && !hasFeeX : !hasFeeY) continue;

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
          includeCtoAccounts: isCtoMint,
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

    if (failures.length > 0 && signatures.length === 0 && transactions.length === 0) {
      const details = failures.map((failure) => `${failure.position}: ${failure.error}`).join("; ");
      throw new Error(`Failed to claim fees for all ${claimTargets.length} targeted position(s): ${details}`);
    }

    return {
      signatures,
      positionsClaimed: claimTargets.length,
      failures: failures.length > 0 ? failures : undefined,
      transactions: params.dryRun ? transactions : undefined,
    };
  }

  /**
   * Stake CTO launch tokens into the per-token stake pool. Rewards start accruing
   * from future CTO fee distributions after this transaction settles.
   */
  async stakeCto(params: CtoStakeParams): Promise<CtoStakingActionResult> {
    const { signer } = this.config;
    const authority = signer.publicKey;
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;

    return this.sendSimpleSignerTransaction(
      [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.config.ctoStakingComputeUnitLimit,
        }),
        buildStakeCtoIx({
          owner: authority,
          tokenMint: params.mint,
          tokenProgram,
          amount: params.amount,
        }),
      ],
      params.dryRun,
    );
  }

  /**
   * Unstake CTO launch tokens. Any pending rewards earned up to the unstake point
   * are settled into the user stake account and remain claimable.
   */
  async unstakeCto(params: CtoUnstakeParams): Promise<CtoStakingActionResult> {
    const { signer } = this.config;
    const authority = signer.publicKey;
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const ownerTokenAccount = getAssociatedTokenAddressSync(
      params.mint,
      authority,
      false,
      tokenProgram,
    );

    return this.sendSimpleSignerTransaction(
      [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.config.ctoStakingComputeUnitLimit,
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          ownerTokenAccount,
          authority,
          params.mint,
          tokenProgram,
        ),
        buildUnstakeCtoIx({
          owner: authority,
          tokenMint: params.mint,
          tokenProgram,
          amount: params.amount,
        }),
      ],
      params.dryRun,
    );
  }

  /**
   * Claim CTO staking rewards. CTO rewards can include both WSOL and the launched
   * token, depending on what fees have been distributed into the stake pool.
   */
  async claimCtoStakingFees(
    params: ClaimCtoStakingFeesParams,
  ): Promise<CtoStakingActionResult> {
    const { signer } = this.config;
    const authority = signer.publicKey;
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const ownerTokenAccount = getAssociatedTokenAddressSync(
      params.mint,
      authority,
      false,
      tokenProgram,
    );
    const ownerWsolAccount = getAssociatedTokenAddressSync(
      WSOL_MINT,
      authority,
      false,
      TOKEN_PROGRAM_ID,
    );

    return this.sendSimpleSignerTransaction(
      [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.config.ctoStakingComputeUnitLimit,
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          ownerTokenAccount,
          authority,
          params.mint,
          tokenProgram,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          ownerWsolAccount,
          authority,
          WSOL_MINT,
          TOKEN_PROGRAM_ID,
        ),
        buildClaimCtoStakingFeesIx(authority, params.mint, tokenProgram),
      ],
      params.dryRun,
    );
  }

  /**
   * Read CTO staking state and calculate pending rewards using the same
   * accumulator/debt math as the on-chain staking program.
   */
  async getCtoStakingStatus(params: GetCtoStakingStatusParams): Promise<CtoStakingStatus> {
    const { connection, signer } = this.config;
    const owner = params.owner ?? signer.publicKey;
    const [launchState] = deriveLaunchState(params.mint);
    const [stakePool] = deriveCtoStakePool(launchState);
    const [userStake] = deriveUserStake(stakePool, owner);

    const launchMode = await readLaunchMode(connection, params.mint);
    const isCto = launchMode === LAUNCH_MODE_CTO;
    const stakePoolInfo = isCto ? await connection.getAccountInfo(stakePool) : null;
    const userStakeInfo = isCto ? await connection.getAccountInfo(userStake) : null;

    const totalStakedRaw = stakePoolInfo
      ? readU64(stakePoolInfo.data, STAKE_POOL_TOTAL_STAKED_OFFSET)
      : BigInt(0);
    const accFeeXPerShare = stakePoolInfo
      ? readU128(stakePoolInfo.data, STAKE_POOL_ACC_FEE_X_PER_SHARE_OFFSET)
      : BigInt(0);
    const accFeeYPerShare = stakePoolInfo
      ? readU128(stakePoolInfo.data, STAKE_POOL_ACC_FEE_Y_PER_SHARE_OFFSET)
      : BigInt(0);

    const stakedRaw = userStakeInfo
      ? readU64(userStakeInfo.data, USER_STAKE_AMOUNT_OFFSET)
      : BigInt(0);
    const feeDebtX = userStakeInfo
      ? readU128(userStakeInfo.data, USER_STAKE_FEE_DEBT_X_OFFSET)
      : BigInt(0);
    const pendingX = userStakeInfo
      ? readU64(userStakeInfo.data, USER_STAKE_PENDING_X_OFFSET)
      : BigInt(0);
    const feeDebtY = userStakeInfo
      ? readU128(userStakeInfo.data, USER_STAKE_FEE_DEBT_Y_OFFSET)
      : BigInt(0);
    const pendingY = userStakeInfo
      ? readU64(userStakeInfo.data, USER_STAKE_PENDING_Y_OFFSET)
      : BigInt(0);

    return {
      mint: params.mint,
      owner,
      launchState,
      stakePool,
      userStake,
      isCto,
      totalStakedRaw,
      stakedRaw,
      pendingRewardsTokenRaw: calculatePendingReward({
        stakedRaw,
        accFeePerShare: accFeeXPerShare,
        feeDebt: feeDebtX,
        storedPending: pendingX,
      }),
      pendingRewardsWsolRaw: calculatePendingReward({
        stakedRaw,
        accFeePerShare: accFeeYPerShare,
        feeDebt: feeDebtY,
        storedPending: pendingY,
      }),
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

  private async sendSimpleSignerTransaction(
    instructions: TransactionInstruction[],
    dryRun = false,
  ): Promise<CtoStakingActionResult> {
    const { connection, signer } = this.config;
    const authority = signer.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);

    if (dryRun) {
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

async function readLaunchMode(
  connection: import("@solana/web3.js").Connection,
  mint: PublicKey,
): Promise<number> {
  const [launchState] = deriveLaunchState(mint);
  const accountInfo = await connection.getAccountInfo(launchState);
  if (!accountInfo || accountInfo.data.length <= LAUNCH_STATE_MODE_OFFSET) {
    return LAUNCH_MODE_NORMAL;
  }
  return accountInfo.data[LAUNCH_STATE_MODE_OFFSET] ?? LAUNCH_MODE_NORMAL;
}

function amountIsPositive(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value > 0;
  if (typeof value === "bigint") return value > BigInt(0);
  if (typeof value === "object") {
    const maybeAmount = value as {
      isZero?: () => boolean;
      isNeg?: () => boolean;
      toNumber?: () => number;
      toString?: () => string;
    };
    if (typeof maybeAmount.isNeg === "function" && maybeAmount.isNeg()) return false;
    if (typeof maybeAmount.isZero === "function") return !maybeAmount.isZero();
    if (typeof maybeAmount.toString === "function") {
      try {
        return BigInt(maybeAmount.toString()) > BigInt(0);
      } catch {
        // Fall through to toNumber below.
      }
    }
    if (typeof maybeAmount.toNumber === "function") return maybeAmount.toNumber() > 0;
  }
  return false;
}

function readU64(data: Buffer | Uint8Array, offset: number): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 8; i += 1) {
    value += BigInt(data[offset + i] ?? 0) << BigInt(8 * i);
  }
  return value;
}

function readU128(data: Buffer | Uint8Array, offset: number): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 16; i += 1) {
    value += BigInt(data[offset + i] ?? 0) << BigInt(8 * i);
  }
  return value;
}

function calculatePendingReward(params: {
  stakedRaw: bigint;
  accFeePerShare: bigint;
  feeDebt: bigint;
  storedPending: bigint;
}): bigint {
  const accrued = (params.stakedRaw * params.accFeePerShare) / CTO_REWARD_SCALE;
  const delta = accrued > params.feeDebt ? accrued - params.feeDebt : BigInt(0);
  return params.storedPending + delta;
}
