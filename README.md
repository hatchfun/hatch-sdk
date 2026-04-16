# hatch-sdk

TypeScript SDK for launching tokens and claiming fees on [Hatch](https://hatch.fm) — a Solana token launcher built on Meteora DLMM.

Designed to be agent-friendly: one client, four methods.

## Install

```bash
pnpm add github:hatch/hatch-sdk
# or
npm install github:hatch/hatch-sdk
```

Peer runtime: Node 18+.

## Quickstart

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { HatchClient } from "hatch-sdk";

const connection = new Connection(process.env.RPC_URL!, "confirmed");
const signer = Keypair.fromSecretKey(/* your secret key bytes */);

const hatch = new HatchClient({ connection, signer });

// 1. Launch a token (mint + pool + locked position with 70% of supply)
//    On a fresh wallet the SDK sends two sequential txs:
//      - setup: InitializeLauncherPda + create WSOL ATA
//      - launch: create token + pool + locked position
//    On subsequent launches from the same wallet, only the launch tx runs.
const { signature, setupSignature, mint, lbPair, position } = await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "https://example.com/metadata.json",
});

// 2. Read on-chain status
const status = await hatch.getLaunchStatus({ mint });
console.log(`Claimable: ${status.totalClaimableSol} SOL`);

// 3. Claim accrued WSOL fees on a launched token
await hatch.claimFees({ mint });

// 4. Sweep referral earnings (if any)
await hatch.claimReferrerFees();
```

## Metadata JSON

The `uri` you pass to `launch()` must resolve to a JSON file in the standard token-metadata format:

```json
{
  "name": "My Token",
  "symbol": "MYTOK",
  "description": "Optional description",
  "image": "https://example.com/logo.png"
}
```

Host it anywhere reachable over HTTPS — S3, IPFS/Pinata, Arweave, a public GitHub Gist, your own server. The SDK does not upload metadata for you.

> **⚠️ The URI is permanent on-chain.** Do not use URLs that may disappear or require auth:
> - **Private GitHub repo `raw.githubusercontent.com` links** return 404 — broken image forever.
> - **Signed URLs** / presigned S3 links expire.
> - **Hot-swappable gist URLs** (without a revision hash) can break if the gist is later deleted or the default branch structure changes. Use the pinned `/raw/<commit-sha>/filename` form.
> - **Host the image on a real CDN** (jsDelivr, your own S3/CloudFront, IPFS pinning service). Avoid private or ephemeral hosts.

## Launch with a referrer

Pass `referrer` on the first launch to immutably record it on your LauncherPda. The referrer earns 4% of your WSOL claim fees going forward (treasury share drops from 20% → 16%).

```ts
await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "https://example.com/metadata.json",
  referrer: new PublicKey("..."),
});
```

The referrer is only written on the first launch (when your LauncherPda is created). Subsequent launches ignore the `referrer` field.

## Fee rate options

Default is **1.00%** bonding curve fee. Override:

```ts
await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "...",
  feeRate: "2.00", // "1.00" | "2.00" | "5.00"
});
```

## Dry run

Build a transaction without sending. Useful for simulating, inspecting, or signing elsewhere.

```ts
const { transaction, mint } = await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "...",
  dryRun: true,
});
// transaction is a VersionedTransaction — sign and send yourself
```

## Cost expectations

A launch costs **~0.25 SOL** in rent + fees, paid by the signer wallet:

| Item | SOL |
|---|---|
| Token-2022 mint rent | ~0.15 |
| LauncherPda (first launch only) | ~0.006 |
| Launch token account rent | ~0.05 |
| DLMM pool rent | ~0.02 |
| Position account rent | ~0.02 |
| Transaction fees | ~0.002 |

Fund the signer wallet before calling `launch()`.

## Fee economics on claim

When you call `claimFees()`:
- All accrued token-side fees are burned on-chain.
- 20% of accrued WSOL → Hatch treasury (or 16%/4% treasury/referrer if you have one).
- Remainder → your signer's WSOL ATA.

## Runnable example

`examples/smoke-launch.ts` does a full launch + status read + claim cycle end-to-end on mainnet. To run:

```bash
cp examples/.env.example examples/.env
# edit examples/.env with your RPC_URL and METADATA_URI
solana-keygen new --no-bip39-passphrase --outfile .smoke-keypair.json
# fund the generated pubkey with ~0.3 SOL on mainnet
pnpm tsx examples/smoke-launch.ts
```

The script prints Solscan links for the setup tx, launch tx, and claim tx.

## Advanced: instruction builders

The high-level client is a thin wrapper over exported primitives. Compose your own transactions:

```ts
import {
  buildCreateTokenAndLaunchAccountIx,
  buildCreatePoolAndLockedPositionIx,
  buildInitializeLauncherPdaIx,
  buildClaimFeeManualIx,
  buildClaimReferrerFeesIx,
  buildInitPoolFeeAccountIx,
  deriveLauncherPda,
  deriveLaunchTokenAccount,
  derivePoolFeeAccount,
  deriveReferrerFeeAccount,
  launcherPdaExists,
  readLauncherPdaReferrer,
  GLOBAL_ALTS,
  HATCH_PROGRAM_ID,
  HATCH_TREASURY,
  WSOL_MINT,
} from "hatch-sdk";
```

Subpath imports are also supported: `hatch-sdk/launch`, `hatch-sdk/fees`, `hatch-sdk/pda`, `hatch-sdk/meteora`, `hatch-sdk/constants`, `hatch-sdk/utils`.

## Troubleshooting

- **`VersionedTransaction too large: 1261 bytes (max: encoded/raw 1644/1232)`** — You're on a version before the split-tx fix. Upgrade to the latest `main`. From a fresh wallet, the SDK now splits setup (LauncherPda + WSOL ATA) and launch (token + pool) into two sequential transactions to stay under the 1232-byte limit.
- **`No claimable positions found for mint ...`** — The signer's LauncherPda doesn't own a position for that mint. Check `getLaunchStatus({ mint })`.
- **`Insufficient funds`** or simulation errors on `launch()` — signer wallet needs ~0.25 SOL.
- **Transaction simulation fails with compute budget error** — bump `launchComputeUnitLimit` / `claimComputeUnitLimit` in `HatchClient` config.
- **RPC timeouts** — use a paid RPC (Helius, QuickNode, Triton) instead of public RPC for production.
- **Launched token shows a broken image in Phantom/Solscan** — your metadata `image` URL is unreachable. Common causes: hosted on a private GitHub repo, presigned S3 URL that expired, or an unpinned gist URL. The on-chain URI is immutable; you'll need to relaunch.

## Security note

An agent using this SDK needs your signing key. **Only use a dedicated, limited-balance hot wallet for agent automation.** Never hand your main wallet's keypair to an agent you didn't write.

## Support

Open a GitHub issue. Best-effort, no SLA.

## License

MIT
