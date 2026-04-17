import assert from "node:assert/strict";
import test from "node:test";
import DLMM from "@meteora-ag/dlmm";
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { HatchClient } from "../src/client/hatch-client";
import { HATCH_PROGRAM_ID, WSOL_MINT } from "../src/constants";
import { deriveLauncherPda } from "../src/pda";

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

function createMockConnection(options: {
  accountInfos?: Record<string, MockAccountInfo | null>;
  blockhashes?: Array<{ blockhash: string; lastValidBlockHeight: number }>;
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

test("claimFees dryRun returns transactions for each targeted position", async () => {
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
                positionData: { lowerBinId: -444, upperBinId: -375 },
              },
              {
                publicKey: Keypair.generate().publicKey,
                positionData: { lowerBinId: -444, upperBinId: -375 },
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
  } finally {
    (DLMM as unknown as { getAllLbPairPositionsByUser: unknown }).getAllLbPairPositionsByUser =
      originalGetAll;
  }
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
