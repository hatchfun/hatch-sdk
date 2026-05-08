import assert from "node:assert/strict";
import test from "node:test";
import DLMM from "@meteora-ag/dlmm";
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { HatchClient } from "../src/client/hatch-client";
import {
  HATCH_PROGRAM_ID,
  LAUNCH_MODE_CTO,
  WSOL_MINT,
} from "../src/constants";
import {
  deriveCtoStakePool,
  deriveLaunchState,
  deriveLauncherPda,
  deriveUserStake,
} from "../src/pda";
import { getInstructionDiscriminator } from "../src/utils";

type MockAccountInfo = {
  data: Buffer;
  executable: boolean;
  lamports: number;
  owner: PublicKey;
  rentEpoch: number;
};

function makeAccountInfo(data: Buffer = Buffer.alloc(0), owner: PublicKey = SystemProgram.programId): MockAccountInfo {
  return {
    data,
    executable: false,
    lamports: 0,
    owner,
    rentEpoch: 0,
  };
}

function makeBlockhash(): { blockhash: string; lastValidBlockHeight: number } {
  return {
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: Math.floor(Math.random() * 1000) + 1,
  };
}

function buildLauncherAccountWithNoReferrer(): MockAccountInfo {
  const data = Buffer.alloc(8 + 32 + 1 + 32);
  return makeAccountInfo(data, HATCH_PROGRAM_ID);
}

function buildLaunchStateAccount(mode: number): MockAccountInfo {
  const data = Buffer.alloc(73);
  data[72] = mode;
  return makeAccountInfo(data, HATCH_PROGRAM_ID);
}

function writeLe(data: Buffer, value: bigint, offset: number, byteLength: number): void {
  let remaining = value;
  for (let i = 0; i < byteLength; i += 1) {
    data[offset + i] = Number(remaining & BigInt(255));
    remaining /= BigInt(256);
  }
}

function createMockConnection(options: {
  accountInfos?: Record<string, MockAccountInfo | null>;
  blockhashes?: Array<{ blockhash: string; lastValidBlockHeight: number }>;
  sendTransaction?: (transaction: unknown) => Promise<string>;
}) {
  const accountInfos = new Map(Object.entries(options.accountInfos ?? {}));
  const blockhashes = [...(options.blockhashes ?? [])];

  const sentTransactions: unknown[] = [];
  const confirmations: unknown[] = [];

  return {
    sentTransactions,
    confirmations,
    async getAccountInfo(pubkey: PublicKey) {
      return accountInfos.get(pubkey.toBase58()) ?? null;
    },
    async getLatestBlockhash() {
      const next = blockhashes.shift();
      if (!next) throw new Error("Missing mock blockhash");
      return next;
    },
    async getAddressLookupTable() {
      return { value: null };
    },
    async sendTransaction(transaction: unknown) {
      if (options.sendTransaction) return options.sendTransaction(transaction);
      sentTransactions.push(transaction);
      return `sig-${sentTransactions.length}`;
    },
    async confirmTransaction(args: unknown) {
      confirmations.push(args);
      return { value: { err: null } };
    },
  };
}

function countNonZeroSignatures(signatures: Uint8Array[]): number {
  return signatures.filter((sig) => sig.some((byte) => byte !== 0)).length;
}

function tokenAmount(amount: number): { toNumber: () => number } {
  return { toNumber: () => amount };
}

test("launch dryRun pre-signs SDK-generated mint and position signers", async () => {
  const signer = Keypair.generate();
  const connection = createMockConnection({
    blockhashes: [makeBlockhash(), makeBlockhash()],
  });

  const client = new HatchClient({ connection: connection as never, signer });
  const result = await client.launch({
    name: "Test Token",
    symbol: "TEST",
    uri: "https://example.com/metadata.json",
    dryRun: true,
  });

  assert.ok(result.transaction, "expected a launch transaction");
  assert.ok(result.setupTransaction, "expected a setup transaction for first launch");
  assert.equal(countNonZeroSignatures(result.transaction!.signatures), 2);
  assert.equal(countNonZeroSignatures(result.setupTransaction!.signatures), 0);

  const launchInstructions = TransactionMessage.decompile(result.transaction!.message).instructions;
  assert.equal(launchInstructions.length, 4);
  assert.deepEqual(
    Array.from(launchInstructions[2].data),
    [43, 136, 170, 96, 251, 157, 75, 235, 0],
  );
  assert.ok(
    launchInstructions[3].keys.some((key) => key.pubkey.equals(deriveLaunchState(result.mint)[0])),
  );
});

test("CTO launch dryRun splits token staking setup from pool creation", async () => {
  const signer = Keypair.generate();
  const connection = createMockConnection({
    blockhashes: [makeBlockhash(), makeBlockhash(), makeBlockhash()],
  });

  const client = new HatchClient({ connection: connection as never, signer });
  const result = await client.launch({
    name: "CTO Token",
    symbol: "CTO",
    uri: "https://example.com/metadata.json",
    launchMode: LAUNCH_MODE_CTO,
    dryRun: true,
  });

  assert.ok(result.setupTransaction, "expected the first-launch setup transaction");
  assert.ok(result.ctoSetupTransaction, "expected CTO token/staking setup transaction");
  assert.ok(result.transaction, "expected final pool creation transaction");
  assert.equal(countNonZeroSignatures(result.ctoSetupTransaction!.signatures), 1);
  assert.equal(countNonZeroSignatures(result.transaction!.signatures), 1);

  const ctoSetupInstructions = TransactionMessage.decompile(
    result.ctoSetupTransaction!.message,
  ).instructions;
  assert.equal(ctoSetupInstructions.length, 6);
  assert.equal(ctoSetupInstructions[2].data[8], LAUNCH_MODE_CTO);

  const [stakePool] = deriveCtoStakePool(deriveLaunchState(result.mint)[0]);
  const poolInstructions = TransactionMessage.decompile(result.transaction!.message).instructions;
  assert.equal(poolInstructions.length, 2);
  assert.ok(poolInstructions[1].keys.some((key) => key.pubkey.equals(stakePool)));
});

test("launch confirms setup transaction with the original setup blockhash tuple", async () => {
  const signer = Keypair.generate();
  const setupBlockhash = makeBlockhash();
  const launchBlockhash = makeBlockhash();
  const connection = createMockConnection({
    blockhashes: [setupBlockhash, launchBlockhash],
  });

  const client = new HatchClient({ connection: connection as never, signer });
  await client.launch({
    name: "Test Token",
    symbol: "TEST",
    uri: "https://example.com/metadata.json",
  });

  assert.equal(connection.sentTransactions.length, 2);
  assert.equal(connection.confirmations.length, 2);
  assert.deepEqual(connection.confirmations[0], {
    signature: "sig-1",
    blockhash: setupBlockhash.blockhash,
    lastValidBlockHeight: setupBlockhash.lastValidBlockHeight,
  });
});

test("claimFees dryRun returns transactions for each non-empty targeted position", async () => {
  const signer = Keypair.generate();
  const [launcherPda] = deriveLauncherPda(signer.publicKey);
  const launcherAccount = buildLauncherAccountWithNoReferrer();
  const tokenMint = Keypair.generate().publicKey;
  const lbPair = Keypair.generate().publicKey;

  const originalGetAll = (DLMM as unknown as { getAllLbPairPositionsByUser: unknown })
    .getAllLbPairPositionsByUser;

  (DLMM as unknown as { getAllLbPairPositionsByUser: (...args: unknown[]) => Promise<Map<string, unknown>> })
    .getAllLbPairPositionsByUser = async () =>
      new Map([
        [
          lbPair.toBase58(),
          {
            tokenX: { publicKey: tokenMint },
            tokenY: { publicKey: WSOL_MINT },
            lbPairPositionsData: [
              {
                publicKey: Keypair.generate().publicKey,
                positionData: { lowerBinId: -444, upperBinId: -375, feeY: tokenAmount(1_000) },
              },
              {
                publicKey: Keypair.generate().publicKey,
                positionData: { lowerBinId: -444, upperBinId: -375, feeY: tokenAmount(0) },
              },
              {
                publicKey: Keypair.generate().publicKey,
                positionData: { lowerBinId: -444, upperBinId: -375, feeY: tokenAmount(2_000) },
              },
            ],
          },
        ],
      ]);

  try {
    const connection = createMockConnection({
      accountInfos: {
        [launcherPda.toBase58()]: launcherAccount,
      },
      blockhashes: [makeBlockhash(), makeBlockhash()],
    });

    const client = new HatchClient({ connection: connection as never, signer });
    const result = await client.claimFees({ mint: tokenMint, dryRun: true });

    assert.equal(result.positionsClaimed, 2);
    assert.equal(result.signatures.length, 0);
    assert.ok(result.transactions);
    assert.equal(result.transactions!.length, 2);
    const claimInstructions = TransactionMessage.decompile(result.transactions![0].message)
      .instructions;
    const claimIx = claimInstructions[claimInstructions.length - 1];
    assert.ok(claimIx.keys.some((key) => key.pubkey.equals(deriveLaunchState(tokenMint)[0])));
  } finally {
    (DLMM as unknown as { getAllLbPairPositionsByUser: unknown }).getAllLbPairPositionsByUser =
      originalGetAll;
  }
});

test("claimFees dryRun routes CTO fee claims to staking vaults", async () => {
  const signer = Keypair.generate();
  const [launcherPda] = deriveLauncherPda(signer.publicKey);
  const launcherAccount = buildLauncherAccountWithNoReferrer();
  const tokenMint = Keypair.generate().publicKey;
  const lbPair = Keypair.generate().publicKey;
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);

  const originalGetAll = (DLMM as unknown as { getAllLbPairPositionsByUser: unknown })
    .getAllLbPairPositionsByUser;

  (DLMM as unknown as { getAllLbPairPositionsByUser: (...args: unknown[]) => Promise<Map<string, unknown>> })
    .getAllLbPairPositionsByUser = async () =>
      new Map([
        [
          lbPair.toBase58(),
          {
            tokenX: { publicKey: tokenMint },
            tokenY: { publicKey: WSOL_MINT },
            lbPairPositionsData: [
              {
                publicKey: Keypair.generate().publicKey,
                positionData: {
                  lowerBinId: -444,
                  upperBinId: -375,
                  feeX: tokenAmount(1_000),
                  feeY: tokenAmount(0),
                },
              },
            ],
          },
        ],
      ]);

  try {
    const connection = createMockConnection({
      accountInfos: {
        [launcherPda.toBase58()]: launcherAccount,
        [launchState.toBase58()]: buildLaunchStateAccount(LAUNCH_MODE_CTO),
      },
      blockhashes: [makeBlockhash()],
    });

    const client = new HatchClient({ connection: connection as never, signer });
    const result = await client.claimFees({ mint: tokenMint, dryRun: true });

    assert.equal(result.positionsClaimed, 1);
    assert.ok(result.transactions);
    const claimInstructions = TransactionMessage.decompile(result.transactions![0].message)
      .instructions;
    const claimIx = claimInstructions[claimInstructions.length - 1];
    assert.ok(
      claimIx.data
        .subarray(0, 8)
        .equals(getInstructionDiscriminator("claim_fee_manual_cto")),
    );
    assert.ok(claimIx.keys.some((key) => key.pubkey.equals(stakePool)));
  } finally {
    (DLMM as unknown as { getAllLbPairPositionsByUser: unknown }).getAllLbPairPositionsByUser =
      originalGetAll;
  }
});

test("claimFees throws when every targeted position fails", async () => {
  const signer = Keypair.generate();
  const [launcherPda] = deriveLauncherPda(signer.publicKey);
  const launcherAccount = buildLauncherAccountWithNoReferrer();
  const tokenMint = Keypair.generate().publicKey;
  const lbPair = Keypair.generate().publicKey;

  const originalGetAll = (DLMM as unknown as { getAllLbPairPositionsByUser: unknown })
    .getAllLbPairPositionsByUser;

  (DLMM as unknown as { getAllLbPairPositionsByUser: (...args: unknown[]) => Promise<Map<string, unknown>> })
    .getAllLbPairPositionsByUser = async () =>
      new Map([
        [
          lbPair.toBase58(),
          {
            tokenX: { publicKey: tokenMint },
            tokenY: { publicKey: WSOL_MINT },
            lbPairPositionsData: [
              {
                publicKey: Keypair.generate().publicKey,
                positionData: { lowerBinId: -444, upperBinId: -375, feeY: tokenAmount(1_000) },
              },
            ],
          },
        ],
      ]);

  try {
    const connection = createMockConnection({
      accountInfos: {
        [launcherPda.toBase58()]: launcherAccount,
      },
      blockhashes: [makeBlockhash()],
      sendTransaction: async () => {
        throw new Error("RPC unavailable");
      },
    });

    const client = new HatchClient({ connection: connection as never, signer });
    await assert.rejects(
      () => client.claimFees({ mint: tokenMint }),
      /Failed to claim fees for all 1 targeted position\(s\).*RPC unavailable/,
    );
  } finally {
    (DLMM as unknown as { getAllLbPairPositionsByUser: unknown }).getAllLbPairPositionsByUser =
      originalGetAll;
  }
});

test("CTO staking actions build stake, unstake, and reward claim transactions", async () => {
  const signer = Keypair.generate();
  const tokenMint = Keypair.generate().publicKey;
  const connection = createMockConnection({
    blockhashes: [makeBlockhash(), makeBlockhash(), makeBlockhash()],
  });
  const client = new HatchClient({ connection: connection as never, signer });

  const stake = await client.stakeCto({
    mint: tokenMint,
    amount: BigInt(10),
    dryRun: true,
  });
  const unstake = await client.unstakeCto({
    mint: tokenMint,
    amount: BigInt(5),
    dryRun: true,
  });
  const claim = await client.claimCtoStakingFees({
    mint: tokenMint,
    dryRun: true,
  });

  assert.ok(stake.transaction);
  assert.ok(unstake.transaction);
  assert.ok(claim.transaction);

  const stakeInstructions = TransactionMessage.decompile(stake.transaction!.message).instructions;
  const unstakeInstructions = TransactionMessage.decompile(unstake.transaction!.message).instructions;
  const claimInstructions = TransactionMessage.decompile(claim.transaction!.message).instructions;

  assert.equal(stakeInstructions.length, 2);
  assert.deepEqual(
    Array.from(stakeInstructions[1].data.subarray(8, 16)),
    [10, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(unstakeInstructions.length, 3);
  assert.deepEqual(
    Array.from(unstakeInstructions[2].data.subarray(8, 16)),
    [5, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(claimInstructions.length, 4);
});

test("getCtoStakingStatus calculates pending rewards from accumulator and debt", async () => {
  const signer = Keypair.generate();
  const tokenMint = Keypair.generate().publicKey;
  const [launchState] = deriveLaunchState(tokenMint);
  const [stakePool] = deriveCtoStakePool(launchState);
  const [userStake] = deriveUserStake(stakePool, signer.publicKey);

  const stakePoolData = Buffer.alloc(256);
  writeLe(stakePoolData, BigInt(1000), 200, 8);
  writeLe(stakePoolData, BigInt("2000000000000000000"), 208, 16);
  writeLe(stakePoolData, BigInt("3000000000000000000"), 240, 16);

  const userStakeData = Buffer.alloc(128);
  writeLe(userStakeData, BigInt(10), 72, 8);
  writeLe(userStakeData, BigInt(5), 80, 16);
  writeLe(userStakeData, BigInt(7), 96, 8);
  writeLe(userStakeData, BigInt(12), 104, 16);
  writeLe(userStakeData, BigInt(13), 120, 8);

  const connection = createMockConnection({
    accountInfos: {
      [launchState.toBase58()]: buildLaunchStateAccount(LAUNCH_MODE_CTO),
      [stakePool.toBase58()]: makeAccountInfo(stakePoolData, HATCH_PROGRAM_ID),
      [userStake.toBase58()]: makeAccountInfo(userStakeData, HATCH_PROGRAM_ID),
    },
  });

  const client = new HatchClient({ connection: connection as never, signer });
  const status = await client.getCtoStakingStatus({ mint: tokenMint });

  assert.equal(status.isCto, true);
  assert.equal(status.totalStakedRaw, BigInt(1000));
  assert.equal(status.stakedRaw, BigInt(10));
  assert.equal(status.pendingRewardsTokenRaw, BigInt(22));
  assert.equal(status.pendingRewardsWsolRaw, BigInt(31));
});

test("claimReferrerFees dryRun auto-initializes the referrer fee account when missing", async () => {
  const signer = Keypair.generate();
  const [launcherPda] = deriveLauncherPda(signer.publicKey);
  const connection = createMockConnection({
    accountInfos: {
      [launcherPda.toBase58()]: buildLauncherAccountWithNoReferrer(),
    },
    blockhashes: [makeBlockhash()],
  });

  const client = new HatchClient({ connection: connection as never, signer });
  const result = await client.claimReferrerFees({ dryRun: true });

  assert.ok(result.transaction, "expected a built dry-run transaction");
  const decompiled = TransactionMessage.decompile(result.transaction!.message);
  assert.equal(decompiled.instructions.length, 3);
  assert.deepEqual(
    Array.from(decompiled.instructions[0].data.subarray(0, 8)),
    [46, 243, 56, 145, 44, 82, 166, 125],
  );
});
