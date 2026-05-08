# hatch-sdk

TypeScript SDK for launching tokens and claiming fees on [Hatch](https://hatchfun.xyz/) — a Solana token launcher built on Meteora DLMM.

Designed to be agent-friendly: one client for launches, fee claims, referrals, and CTO staking.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Versioning](#versioning)
- [Public Usage Policy](#public-usage-policy)
- [Setup](#setup)
- [API reference](#api-reference)
  - [`new HatchClient(config)`](#new-hatchclientconfig)
  - [`hatch.launch(params)`](#hatchlaunchparams)
  - [`hatch.claimFees(params)`](#hatchclaimfeesparams)
  - [`hatch.stakeCto(params)`](#hatchstakectoparams)
  - [`hatch.unstakeCto(params)`](#hatchunstakectoparams)
  - [`hatch.claimCtoStakingFees(params)`](#hatchclaimctostakingfeesparams)
  - [`hatch.getCtoStakingStatus(params)`](#hatchgetctostakingstatusparams)
  - [`hatch.initReferrerFeeAccount(params?)`](#hatchinitreferrerfeeaccountparams)
  - [`hatch.claimReferrerFees(params?)`](#hatchclaimreferrerfeesparams)
  - [`hatch.getLaunchStatus(params)`](#hatchgetlaunchstatusparams)
- [Step-by-step: your first launch](#step-by-step-your-first-launch)
- [Metadata JSON](#metadata-json)
- [Agent Launch Checklist](#agent-launch-checklist)
- [CTO mode](#cto-mode)
- [Referrals](#referrals)
- [Fee rate options](#fee-rate-options)
- [Dry run mode](#dry-run-mode)
- [Cost breakdown](#cost-breakdown)
- [Fee economics on claim](#fee-economics-on-claim)
- [Advanced: instruction builders](#advanced-instruction-builders)
- [How it works under the hood](#how-it-works-under-the-hood)
- [Troubleshooting](#troubleshooting)
- [Agent Safety](#agent-safety)
- [Security](#security)
- [License](#license)

---

## Prerequisites

- **Node.js** 18+
- **pnpm**, **npm**, or **yarn**
- A **Solana keypair** (the signer / fee payer)
- A **Solana RPC URL** — the public endpoint works for testing but use a paid provider (Helius, QuickNode, Triton) for production
- **~0.3 SOL** in the signer wallet (0.25 SOL rent + fees, plus buffer)
- A **publicly hosted metadata JSON file** (see [Metadata JSON](#metadata-json))

## Install

```bash
# from GitHub main (moving target; okay for now, but pin a tag or commit for production)
pnpm add https://github.com/hatchfun/hatch-sdk.git
# or
npm install https://github.com/hatchfun/hatch-sdk.git
```

> **Note:** The SDK ships TypeScript source (no compiled JS). Your project must handle `.ts` imports — use `tsx`, `ts-node`, or a bundler that supports TypeScript.
> **Recommendation:** For agents and production automation, pin to a Git tag or commit SHA. Avoid installing from a moving branch like `main`.

## Versioning

This SDK is not on npm yet. If you plan to share it publicly for agents, prefer one of these release models:

- Best: publish tagged GitHub releases and have users install by tag or commit SHA.
- Better than nothing: tell users to pin a specific commit SHA.
- Avoid: telling users to clone or install straight from a moving `main` branch.

Why:

- agents are more reliable when everyone uses the same exact SDK build
- rollback is simpler if a bad change lands
- audit findings and support requests are easier to map to a concrete version
- supply-chain risk is lower when consumers pin immutable refs

If you do not want npm overhead yet, GitHub tags are enough. You do not need a registry publish to get the safety benefits of versioning.

## Public Usage Policy

If you are consuming this SDK from outside Hatch, use these rules:

- Preferred install target: a tagged release or pinned commit SHA.
- Current pre-release install target: `https://github.com/hatchfun/hatch-sdk.git`
- After the first tag is cut, stop recommending the moving `main` branch.
- Recommended interface for agents: the high-level `HatchClient`.
- Advanced interface: the low-level instruction builders are available, but they are easier to misuse and should be treated as expert-only.
- Signing policy: simulate and review before requesting a live signature.
- Wallet policy: use a dedicated launcher hot wallet with limited SOL balance.

In short: pin versions, prefer the high-level client, and do not treat `main` as a stable release channel.

## Setup

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { HatchClient } from "hatch-sdk";

// 1. Connect to Solana
const connection = new Connection("YOUR_RPC_URL", "confirmed");

// 2. Load your signer keypair
//    The signer pays for all transactions and becomes the token launcher.
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync("keypair.json", "utf-8")));
const signer = Keypair.fromSecretKey(secretKey);

// 3. Create the client
const hatch = new HatchClient({ connection, signer });
```

### Config options

```ts
const hatch = new HatchClient({
  connection,                    // required — Solana RPC connection
  signer,                        // required — Keypair that signs and pays
  launchComputeUnitLimit: 1_200_000,  // optional — CU budget for launch tx (default: 1.2M)
  claimComputeUnitLimit: 1_400_000,   // optional — CU budget for claim tx (default: 1.4M)
  ctoStakingComputeUnitLimit: 200_000, // optional — CU budget for CTO stake txs
});
```

---

## API reference

### `new HatchClient(config)`

Creates a new SDK client.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `connection` | `Connection` | yes | — | Solana RPC connection |
| `signer` | `Keypair` | yes | — | Signs and pays for all transactions |
| `launchComputeUnitLimit` | `number` | no | `1,200,000` | Compute unit budget for the launch transaction |
| `claimComputeUnitLimit` | `number` | no | `1,400,000` | Compute unit budget for claim transactions |
| `ctoStakingComputeUnitLimit` | `number` | no | `200,000` | Compute unit budget for CTO stake, unstake, and staking-reward claim transactions |

---

### `hatch.launch(params)`

Launch a new token with a locked Meteora DLMM position.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | yes | — | Token name, stored in Token-2022 metadata on-chain. **Immutable.** |
| `symbol` | `string` | yes | — | Token ticker / symbol. **Immutable.** |
| `uri` | `string` | yes | — | HTTPS URL pointing to a JSON metadata file. **Immutable on-chain.** See [Metadata JSON](#metadata-json). |
| `referrer` | `PublicKey` | no | — | Referrer wallet pubkey. Only recorded on first launch (when LauncherPda is created). See [Referrals](#referrals). |
| `feeRate` | `"1.00" \| "2.00" \| "5.00"` | no | `"1.00"` | Bonding curve fee rate for the pool. See [Fee rate options](#fee-rate-options). |
| `launchMode` | `LaunchMode` | no | `LAUNCH_MODE_NORMAL` | Use `LAUNCH_MODE_CTO` to initialize CTO stake-weighted fee distribution. |
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send the transaction(s). See [Dry run mode](#dry-run-mode). |

#### Returns `Promise<LaunchResult>`

| Field | Type | Description |
|---|---|---|
| `signature` | `string` | Main launch transaction signature. Empty string if `dryRun`. |
| `setupSignature` | `string \| undefined` | Setup transaction signature, present only if this was the first launch from this wallet (LauncherPda and/or WSOL ATA had to be created). |
| `ctoSetupSignature` | `string \| undefined` | CTO token/staking setup transaction signature, present only for CTO launches. |
| `mint` | `PublicKey` | The newly-created SPL token mint address. |
| `launcherPda` | `PublicKey` | The LauncherPda account that owns the locked position. Derived from signer. |
| `lbPair` | `PublicKey` | The Meteora DLMM pool address. |
| `position` | `PublicKey` | The locked Meteora position address. |
| `transaction` | `VersionedTransaction \| undefined` | Launch transaction, already signed by any SDK-generated ephemeral signers when `dryRun: true`. You still sign with your wallet before sending. |
| `setupTransaction` | `VersionedTransaction \| undefined` | Setup transaction (only when `dryRun: true` and setup is needed). |
| `ctoSetupTransaction` | `VersionedTransaction \| undefined` | CTO token/staking setup transaction when `dryRun: true` and `launchMode` is CTO. |

#### Example

```ts
const result = await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "https://example.com/metadata.json",
});

console.log("Token mint:", result.mint.toBase58());
console.log("Pool:", result.lbPair.toBase58());
console.log("Tx:", `https://solscan.io/tx/${result.signature}`);
```

#### CTO launch example

```ts
import { LAUNCH_MODE_CTO } from "hatch-sdk/constants";

const result = await hatch.launch({
  name: "My CTO Token",
  symbol: "MCTO",
  uri: "https://example.com/metadata.json",
  launchMode: LAUNCH_MODE_CTO,
});

console.log("CTO setup tx:", result.ctoSetupSignature);
console.log("Pool tx:", result.signature);
```

CTO launches create the normal Token-2022 mint and locked DLMM position, plus:

- `LaunchState` with immutable mode `LAUNCH_MODE_CTO`
- `CtoStakePool`
- CTO stake vault for the launched token
- CTO fee vault for launched-token rewards
- CTO fee vault for WSOL rewards

The high-level client sends CTO launch setup and pool creation as separate transactions to stay below Solana's transaction-size limit. If you require atomic launch execution, use `dryRun: true` and submit the returned `ctoSetupTransaction` and `transaction` through your own bundle flow.

---

### `hatch.claimFees(params)`

Claim accrued fees from a launched token's position(s). The SDK automatically resolves all positions for the given mint under the signer's LauncherPda.

For normal launches, `claimFees()` sends claimable WSOL to the launcher after the protocol cut and burns token-side fees. For CTO launches, the SDK detects `LaunchState.mode === LAUNCH_MODE_CTO` and uses the CTO claim route: 80% of WSOL fees and 80% of launched-token fees are distributed into the CTO staking vaults, while the 20% launched-token share is burned.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | The launched token mint to claim fees from. |
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

#### Returns `Promise<ClaimFeesResult>`

| Field | Type | Description |
|---|---|---|
| `signatures` | `string[]` | Transaction signatures, one per claimed position. |
| `positionsClaimed` | `number` | Number of positions targeted in this call. |
| `failures` | `Array<{ position: string; error: string }> \| undefined` | Per-position failures when at least one target failed without aborting the whole loop. |
| `transactions` | `VersionedTransaction[] \| undefined` | Built claim transactions when `dryRun: true`, one per targeted position. |

#### Example

```ts
import { PublicKey } from "@solana/web3.js";

const result = await hatch.claimFees({
  mint: new PublicKey("EoxWxMev..."),
});

console.log(`Claimed ${result.positionsClaimed} position(s)`);
for (const sig of result.signatures) {
  console.log(`  https://solscan.io/tx/${sig}`);
}
```

---

### `hatch.stakeCto(params)`

Stake CTO launch tokens into the token's CTO stake pool.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | CTO token mint. |
| `amount` | `bigint` | yes | — | Raw token amount in mint base units. Hatch launch tokens use 9 decimals. |
| `tokenProgram` | `PublicKey` | no | `TOKEN_2022_PROGRAM_ID` | Token program for the launched mint. |
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

#### Returns `Promise<CtoStakingActionResult>`

| Field | Type | Description |
|---|---|---|
| `signature` | `string` | Transaction signature. Empty string if `dryRun`. |
| `transaction` | `VersionedTransaction \| undefined` | Built transaction when `dryRun: true`. |

#### Example

```ts
const oneToken = BigInt(1_000_000_000); // 1 token with 9 decimals

await hatch.stakeCto({
  mint: new PublicKey("CTO_TOKEN_MINT"),
  amount: oneToken,
});
```

---

### `hatch.unstakeCto(params)`

Unstake CTO launch tokens. Pending rewards are settled into the user stake account before the staked amount changes, so they remain claimable.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | CTO token mint. |
| `amount` | `bigint` | yes | — | Raw token amount in mint base units. |
| `tokenProgram` | `PublicKey` | no | `TOKEN_2022_PROGRAM_ID` | Token program for the launched mint. |
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

---

### `hatch.claimCtoStakingFees(params)`

Claim the signer's CTO staking rewards. A CTO staker may receive both WSOL and the launched token.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | CTO token mint. |
| `tokenProgram` | `PublicKey` | no | `TOKEN_2022_PROGRAM_ID` | Token program for the launched mint. |
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

#### Example

```ts
const result = await hatch.claimCtoStakingFees({
  mint: new PublicKey("CTO_TOKEN_MINT"),
});

console.log(`https://solscan.io/tx/${result.signature}`);
```

---

### `hatch.getCtoStakingStatus(params)`

Read CTO staking state and calculate pending rewards. Pure read — no transactions sent.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | CTO token mint. |
| `owner` | `PublicKey` | no | client signer | Staker wallet to inspect. |

#### Returns `Promise<CtoStakingStatus>`

| Field | Type | Description |
|---|---|---|
| `isCto` | `boolean` | True when the mint has a LaunchState with CTO mode. |
| `stakePool` | `PublicKey` | CTO stake pool PDA. |
| `userStake` | `PublicKey` | User stake PDA for this owner. |
| `totalStakedRaw` | `bigint` | Total amount staked in raw base units. |
| `stakedRaw` | `bigint` | Owner's staked amount in raw base units. |
| `pendingRewardsTokenRaw` | `bigint` | Claimable launched-token reward in raw base units. |
| `pendingRewardsWsolRaw` | `bigint` | Claimable WSOL reward in lamports. |

#### Example

```ts
const status = await hatch.getCtoStakingStatus({
  mint: new PublicKey("CTO_TOKEN_MINT"),
});

console.log("Is CTO:", status.isCto);
console.log("Staked raw:", status.stakedRaw.toString());
console.log("Pending WSOL lamports:", status.pendingRewardsWsolRaw.toString());
console.log("Pending token raw:", status.pendingRewardsTokenRaw.toString());
```

---

### `hatch.initReferrerFeeAccount(params?)`

Initialize the signer's referrer fee account PDA. A referrer should do this once before referred users start claiming fees, otherwise Hatch falls back to sending the 4% referrer cut to treasury.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

#### Returns `Promise<InitReferrerFeeAccountResult>`

| Field | Type | Description |
|---|---|---|
| `signature` | `string` | Transaction signature. Empty string if `dryRun` or if the account already exists. |
| `transaction` | `VersionedTransaction \| undefined` | Built init transaction when `dryRun: true`. |

#### Example

```ts
const result = await hatch.initReferrerFeeAccount();
if (result.signature) {
  console.log(`https://solscan.io/tx/${result.signature}`);
}
```

---

### `hatch.claimReferrerFees(params?)`

Sweep accumulated referral earnings to the signer's WSOL ATA. Only relevant if other launchers used your wallet as their `referrer`.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `dryRun` | `boolean` | no | `false` | If `true`, builds but does not send. |

#### Returns `Promise<ClaimReferrerFeesResult>`

| Field | Type | Description |
|---|---|---|
| `signature` | `string` | Transaction signature. Empty string if `dryRun`. |
| `transaction` | `VersionedTransaction \| undefined` | Built claim transaction when `dryRun: true`. |

#### Example

```ts
const result = await hatch.claimReferrerFees();
console.log(`https://solscan.io/tx/${result.signature}`);
```

---

### `hatch.getLaunchStatus(params)`

Read on-chain status for a launched token. Pure read — no transactions sent.

#### Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `mint` | `PublicKey` | yes | — | The launched token mint to query. |

#### Returns `Promise<LaunchStatus>`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The token mint queried. |
| `launcherPda` | `PublicKey` | The LauncherPda derived from the signer. |
| `launcherExists` | `boolean` | Whether the LauncherPda account exists on-chain. |
| `positions` | `Array<Position>` | Matching positions (see below). |
| `totalClaimableSol` | `number` | Aggregate claimable SOL (in SOL, not lamports) across all positions for this mint. |

Each position in the array:

| Field | Type | Description |
|---|---|---|
| `position` | `PublicKey` | Position account address. |
| `lbPair` | `PublicKey` | The DLMM pool this position belongs to. |
| `claimableSol` | `number` | Claimable WSOL from this position (in SOL, after the 20% treasury cut). |
| `allTimeFeeSol` | `number` | All-time WSOL fees earned by this position (in SOL, after treasury cut). |
| `activeBinId` | `number` | Current active bin of the pool. Higher = price has moved up. |

#### Example

```ts
import { PublicKey } from "@solana/web3.js";

const status = await hatch.getLaunchStatus({
  mint: new PublicKey("EoxWxMev..."),
});

console.log("Positions:", status.positions.length);
console.log("Claimable:", status.totalClaimableSol, "SOL");
if (status.positions[0]) {
  console.log("Active bin:", status.positions[0].activeBinId);
}
```

---

## Step-by-step: your first launch

### 1. Generate a signer keypair

```bash
solana-keygen new --no-bip39-passphrase --outfile signer.json
```

Save the pubkey output — you'll fund it in the next step.

### 2. Fund the signer

Send **~0.3 SOL** (0.25 rent + fees, plus buffer) to the signer pubkey on **Solana mainnet**.

### 3. Create and host your metadata JSON

The `uri` you pass to `launch()` must be the URL of a JSON file, not the URL of the token image itself.

Use this pattern:

- `uri`: `https://your-domain.com/metadata/my-token.json`
- `image` inside that JSON: `https://your-domain.com/images/my-token.png`

Create a file like this:

```json
{
  "name": "My Token",
  "symbol": "MYTOK",
  "description": "A short description of your token.",
  "image": "https://example.com/logo.png",
  "extensions": {
    "twitter": "https://x.com/mytoken",
    "website": "https://mytoken.example",
    "telegram": "https://t.me/mytoken"
  }
}
```

`extensions` is optional, but this is the canonical place for Hatch social links. Omit the whole object if you do not have socials yet.

Host it at a **permanent, public HTTPS URL**. Options:
- **GitHub Gist** (public, pinned revision URL) — free, quick
- **IPFS / Pinata** — decentralized, permanent
- **Arweave** — truly permanent, ~$0.01
- **Your own S3 / CloudFront** — full control

Before launch, verify:

- the JSON URL opens publicly in a browser
- the URL returns JSON, not HTML
- the `image` URL opens publicly
- any social URLs under `extensions` open publicly
- `name` and `symbol` match the values you will pass to `launch()`
- both URLs are permanent, because the on-chain `uri` is immutable

Helpful files in this repo:

- [examples/metadata-template.json](/Users/lorenzoampil_1/global/hatch-sdk/examples/metadata-template.json)
- `pnpm tsx examples/cto-launch.ts`
- `pnpm tsx examples/cto-staking.ts`
- `pnpm tsx examples/validate-metadata.ts <metadata-json-path-or-url>`

> **The URI is stored on-chain and cannot be changed after launch.**
>
> Do NOT use:
> - Private GitHub repo `raw.githubusercontent.com` links (404 for everyone else)
> - Presigned S3 URLs (they expire)
> - Unpinned gist URLs (can break if gist is deleted)

### 4. Install the SDK

```bash
mkdir my-launch && cd my-launch
pnpm init
pnpm add github:hatchfun/hatch-sdk
pnpm add -D tsx
```

### 5. Write your launch script

```ts
// launch.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { HatchClient } from "hatch-sdk";

async function main() {
  const connection = new Connection("YOUR_RPC_URL", "confirmed");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("signer.json", "utf-8"))),
  );

  console.log("Signer:", signer.publicKey.toBase58());
  const balance = (await connection.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL;
  console.log("Balance:", balance, "SOL");

  const hatch = new HatchClient({ connection, signer });

  // Launch
  const result = await hatch.launch({
    name: "My Token",
    symbol: "MYTOK",
    uri: "https://your-permanent-metadata-url.json",
  });

  console.log("Launched!");
  console.log("  Mint:", result.mint.toBase58());
  console.log("  Pool:", result.lbPair.toBase58());
  console.log("  Tx:", `https://solscan.io/tx/${result.signature}`);

  // Check status
  const status = await hatch.getLaunchStatus({ mint: result.mint });
  console.log("  Active bin:", status.positions[0]?.activeBinId);
  console.log("  Claimable:", status.totalClaimableSol, "SOL");
}

main().catch(console.error);
```

### 6. Run it

```bash
pnpm tsx launch.ts
```

Output:
```
Signer: FHdQ...mEn
Balance: 0.3 SOL
Launched!
  Mint: Eox...5J
  Pool: M1H...GC
  Tx: https://solscan.io/tx/TcTr...Qes
  Active bin: -444
  Claimable: 0 SOL
```

### 7. Claim fees later

Once people buy your token, fees accrue. Claim them:

```ts
const claimResult = await hatch.claimFees({
  mint: new PublicKey("YOUR_TOKEN_MINT"),
});
console.log(`Claimed from ${claimResult.positionsClaimed} position(s)`);
```

---

## Metadata JSON

The `uri` parameter in `launch()` points to a JSON file that wallets (Phantom, Solflare) and explorers (Solscan, Birdeye) use to display your token. Expected format:

```json
{
  "name": "My Token",
  "symbol": "MYTOK",
  "description": "Shown in explorers, wallets, and Hatch.",
  "image": "https://permanent-url.com/logo.png",
  "extensions": {
    "twitter": "https://x.com/mytoken",
    "website": "https://mytoken.example",
    "telegram": "https://t.me/mytoken"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Display name in wallets. Should match what you pass to `launch()`. |
| `symbol` | yes | Ticker. Should match the `symbol` param. |
| `description` | yes | Short description shown in explorers, wallets, and Hatch. Use an empty string if omitted. |
| `image` | yes | Public media URL used as the token icon/preview. Must be publicly accessible forever. |
| `extensions` | no | Social links object. Supported keys: `twitter`, `website`, `telegram`. Values must be public HTTP(S) URLs. |

Important distinction:

- `launch({ uri })` expects the metadata JSON URL
- the `image` field inside that JSON expects the direct image URL

Good:

```ts
await hatch.launch({
  name: "hat",
  symbol: "hat",
  uri: "https://example.com/metadata/hat.json",
});
```

Where `https://example.com/metadata/hat.json` contains:

```json
{
  "name": "hat",
  "symbol": "hat",
  "description": "hat token",
  "image": "https://example.com/images/hat.png",
  "extensions": {
    "twitter": "https://x.com/hat"
  }
}
```

Bad:

```ts
await hatch.launch({
  name: "hat",
  symbol: "hat",
  uri: "https://example.com/images/hat.png"
});
```

That passes an image URL where Hatch expects a metadata JSON URL.

Suggested agent workflow for metadata:

1. Ask the user for `name`, `symbol`, short description, image URL, and optional socials (`twitter`, `website`, `telegram`).
2. Create a metadata JSON document using those fields, putting socials under `extensions`.
3. Host the JSON at a permanent public URL.
4. Verify the JSON URL, image URL, and any social URLs load correctly.
5. Read back the exact `uri` that will be written on-chain before asking for signature.

Suggested metadata template:

```json
{
  "name": "TOKEN_NAME",
  "symbol": "TICKER",
  "description": "Short description shown in explorers, wallets, and Hatch.",
  "image": "https://your-public-image-url.png",
  "extensions": {
    "twitter": "https://x.com/your-handle",
    "website": "https://your-project.example",
    "telegram": "https://t.me/your-channel"
  }
}
```

If an agent is helping a user launch, it should explicitly confirm:

- the metadata JSON URL that will be used as `uri`
- the image URL inside that JSON
- any social URLs inside `extensions`
- that all URLs are public and permanent

You can validate a local file or hosted URL with:

```bash
pnpm tsx examples/validate-metadata.ts examples/metadata-template.json
# or
pnpm tsx examples/validate-metadata.ts https://your-domain.com/metadata/my-token.json
```

## Agent Launch Checklist

If an agent is launching a token from scratch, this is the recommended order:

1. Ask for the target cluster and RPC URL.
2. Ask for the signer wallet path or signing method.
3. Ask for `name`, `symbol`, short description, image URL, optional socials, fee tier, launch mode, and optional referrer.
4. Create the metadata JSON from those fields, putting socials under `extensions`.
5. Host the metadata JSON at a permanent public URL.
6. Validate the metadata JSON URL, image URL, and any social URLs.
7. Read back the exact launch inputs:
   - `name`
   - `symbol`
   - metadata JSON `uri`
   - image URL inside the metadata JSON
   - social URLs inside `extensions`, if any
   - fee tier
   - launch mode (`LAUNCH_MODE_NORMAL` or `LAUNCH_MODE_CTO`)
   - referrer, if any
   - cluster / RPC target
8. Run `dryRun: true` or RPC simulation first.
9. Show the user the simulation result and expected account creations.
10. Only then ask for approval to send the real launch transaction.

This is the safest and clearest workflow for agent-assisted launches.

## CTO mode

CTO mode is Hatch's stake-weighted fee distribution mode. A CTO launch still creates the same Token-2022 mint, launch token account, LaunchState, Meteora DLMM pool, and permanently locked position. The difference is that CTO launches also create staking infrastructure for the launched token.

### CTO fee routing

When `claimFees()` is called for a CTO token:

1. Meteora fees are claimed from the Hatch-owned position.
2. 20% of WSOL fees goes to the Hatch treasury/referrer path, matching normal fee handling.
3. 80% of WSOL fees goes to the CTO WSOL fee vault for stakers.
4. 80% of launched-token fees goes to the CTO token fee vault for stakers.
5. The remaining 20% of launched-token fees is burned.

If nobody has staked yet, the on-chain program uses the CTO mode's no-staker behavior for that distribution. Future stakers do not receive retroactive rewards from fees that were already claimed before they staked.

### CTO staking accounting

The staking pool uses standard accumulator/debt accounting:

- `accFeeXPerShare` tracks launched-token rewards per staked token.
- `accFeeYPerShare` tracks WSOL rewards per staked token.
- each user stake account stores `amount`, fee debt, and pending rewards.
- staking or unstaking first settles the user's currently earned rewards into pending balances, then updates `amount` and fee debt.
- claiming transfers pending WSOL and launched-token rewards to the staker.

This keeps distributions compute-efficient because fee claims update the global accumulators once, while each staker pays their own accounting cost when they stake, unstake, or claim.

Important timing detail: CTO rewards are allocated when Hatch fees are claimed/distributed, not at the exact swap that generated those fees. Hatch automation is expected to call claim/distribute frequently, but accounting is based on claim time.

### CTO launch and transaction size

CTO launch setup has more accounts than a normal launch. The high-level SDK sends:

1. optional first-wallet setup transaction for LauncherPda/WSOL ATA,
2. CTO token and staking setup transaction,
3. pool/locked-position creation transaction.

This split avoids Solana's transaction-size limit. It is not an atomic bundle by default. For atomic execution, call `launch({ launchMode: LAUNCH_MODE_CTO, dryRun: true })` and submit `ctoSetupTransaction` and `transaction` through your own bundle sender.

## Referrals

The Hatch program has a built-in referral system. When a launcher has a referrer, the fee split on claims changes:

| | No referrer | With referrer |
|---|---|---|
| Launcher (you) | 80% | 80% |
| Treasury | 20% | 16% |
| Referrer | — | 4% |

To set a referrer, pass `referrer` on your **first launch** (the one that creates your LauncherPda):

```ts
await hatch.launch({
  name: "My Token",
  symbol: "MYTOK",
  uri: "...",
  referrer: new PublicKey("REFERRER_WALLET_PUBKEY"),
});
```

The referrer is **immutable** — it's written once when the LauncherPda is created and cannot be changed. On subsequent launches, the `referrer` field is ignored.

The referrer should initialize their fee account once before referred users start claiming:

```ts
await hatch.initReferrerFeeAccount();
```

The referrer can then sweep their earnings anytime with `hatch.claimReferrerFees()`. `claimReferrerFees()` also auto-initializes the fee account if it is missing, but initializing it early is important so the 4% referrer cut is not redirected to treasury before the account exists.

## Fee rate options

The pool's bonding curve fee rate determines how much of each swap goes to the position as fees. Higher fee = more earnings per trade, but wider spread may reduce trading volume.

| Rate | Preset address | Notes |
|---|---|---|
| `"1.00"` | `Ak1mPM23...` | Default. Best for most launches. |
| `"2.00"` | `4DovFrjt...` | Higher fees, wider spread. |
| `"5.00"` | `7pz5PW7s...` | Aggressive. Use only if you expect low volume but want max capture. |

```ts
await hatch.launch({
  name: "...",
  symbol: "...",
  uri: "...",
  feeRate: "2.00",
});
```

## Dry run mode

All methods accept `dryRun: true`. This builds the transaction(s) but does **not** send them. Useful for:
- Simulating to check if the tx would succeed
- Inspecting the tx before signing
- Signing with a different signer (e.g., a hardware wallet)

```ts
// Dry run launch
const { transaction, setupTransaction, ctoSetupTransaction, mint } = await hatch.launch({
  name: "...",
  symbol: "...",
  uri: "...",
  dryRun: true,
});

// setupTransaction is present only if LauncherPda / WSOL ATA needs to be created.
// ctoSetupTransaction is present only for CTO launches.
// SDK-generated mint/position keypairs are pre-signed on returned launch txs.
// You still sign each transaction with your wallet before sending.

if (setupTransaction) {
  setupTransaction.sign([signer]);
  await connection.sendTransaction(setupTransaction);
  // wait for confirmation...
}

if (ctoSetupTransaction) {
  ctoSetupTransaction.sign([signer]);
  await connection.sendTransaction(ctoSetupTransaction);
  // wait for confirmation...
}

transaction.sign([signer]);
await connection.sendTransaction(transaction);
```

## Cost breakdown

A normal launch costs **~0.25 SOL** in rent + transaction fees, paid by the signer:

| Item | SOL | Notes |
|---|---|---|
| Token-2022 mint | ~0.15 | Rent for the mint account with metadata extension |
| Launch token account | ~0.05 | Holds the 30% reserve supply |
| DLMM pool | ~0.02 | Meteora lbPair account rent |
| Position account | ~0.02 | Locked position rent |
| LauncherPda | ~0.006 | First launch only — skipped on subsequent launches |
| WSOL ATA | ~0.002 | First launch only |
| Transaction fees | ~0.002 | Two txs on first launch, one on subsequent |

**Measured on mainnet:** 0.254 SOL for a fresh-wallet launch.

CTO launches add stake-pool and vault rent. Budget roughly **+0.012 SOL** over the normal launch cost. The exact value can move with Solana rent settings and transaction fees.

Staking also creates a user stake account the first time a wallet stakes into a CTO token. Budget roughly **~0.003 SOL** rent plus transaction fees for a first stake from a wallet.

Rent is recoverable if accounts are closed (but the locked position is permanent by design).

## Fee economics on claim

When you call `claimFees()` for a normal launch:

1. **Token-side fees** (the launched token) — burned on-chain. You never receive these.
2. **WSOL-side fees** — split as follows:

| Recipient | % | Notes |
|---|---|---|
| You (launcher) | 80% | Sent to your WSOL ATA, unwrap to SOL yourself |
| Hatch treasury | 20% | Protocol fee. Drops to 16% if you have a referrer. |
| Referrer | 0% or 4% | Only if your LauncherPda has a referrer set. |

The WSOL lands in your signer's associated token account. Use `spl-token unwrap` or any wallet to convert to SOL.

For CTO launches, `claimFees()` becomes a distribution action:

| Asset | 80% share | 20% share |
|---|---|---|
| WSOL fees | Sent to CTO WSOL fee vault for stakers | Hatch treasury/referrer path |
| Launched-token fees | Sent to CTO token fee vault for stakers | Burned |

Stakers claim their share later with `claimCtoStakingFees()`.

## Advanced: instruction builders

The high-level `HatchClient` is a thin wrapper. For full control over transaction composition, import the primitives directly:

```ts
import {
  // Launch instructions
  buildCreateTokenAndLaunchAccountIx,
  buildCreatePoolAndLockedPositionIx,
  buildInitializeLaunchStateIx,
  buildInitializeLauncherPdaIx,
  buildInitializeCtoStakePoolIx,
  buildInitializeCtoFeeVaultXIx,
  buildInitializeCtoFeeVaultYIx,

  // Fee instructions
  buildClaimFeeIx,
  buildClaimFeeManualIx,
  buildClaimReferrerFeesIx,
  buildInitPoolFeeAccountIx,
  buildInitReferrerFeeAccountIx,

  // CTO staking instructions
  buildStakeCtoIx,
  buildUnstakeCtoIx,
  buildClaimCtoStakingFeesIx,

  // PDA helpers
  deriveCtoFeeVaultX,
  deriveCtoFeeVaultY,
  deriveCtoStakePool,
  deriveCtoStakeVault,
  deriveLauncherPda,
  deriveLaunchTokenAccount,
  deriveLaunchState,
  derivePoolFeeAccount,
  deriveReferrerFeeAccount,
  deriveUserStake,
  launcherPdaExists,
  readLauncherPdaReferrer,

  // Meteora helpers
  deriveLbPair,
  deriveMeteoraPoolAccounts,
  findMeteoraTickArrays,
  findMeteoraClaimTickArrays,

  // Constants
  GLOBAL_ALTS,
  HATCH_PROGRAM_ID,
  HATCH_TREASURY,
  LAUNCH_MODE_CTO,
  LAUNCH_MODE_NORMAL,
  WSOL_MINT,
  METEORA_DLMM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "hatch-sdk";
```

Subpath imports also work:

```ts
import { buildCreateTokenAndLaunchAccountIx } from "hatch-sdk/launch";
import { buildClaimFeeManualIx } from "hatch-sdk/fees";
import { buildStakeCtoIx } from "hatch-sdk/staking";
import { deriveLauncherPda } from "hatch-sdk/pda";
import { deriveLbPair } from "hatch-sdk/meteora";
import { HATCH_PROGRAM_ID } from "hatch-sdk/constants";
```

---

## How it works under the hood

### Token properties (all hardcoded by the Hatch program)

| Property | Value |
|---|---|
| Token program | Token-2022 (SPL Token Extensions) |
| Decimals | 9 |
| Total supply | 1,000,000,000 (1 billion) |
| Metadata | Token-2022 native `TokenMetadata` extension (not Metaplex) |
| Mint authority | Disabled after initial mint |
| Freeze authority | None |

### Pool properties (all hardcoded by the Hatch program)

| Property | Value |
|---|---|
| DEX | Meteora DLMM |
| Quote token | WSOL |
| Strategy | CurveImBalanced (type 7) |
| Bin range | -444 to -375 (70 bins) |
| Starting active bin | -444 (bottom — price goes up as people buy) |
| Liquidity locked | 70% of supply (700M tokens) |
| Remaining supply | 30% held in the launch token account |
| Position | Permanently locked — cannot be withdrawn |

### Transaction flow

**Normal first launch from a wallet (2 transactions):**

```
Setup tx (small, ~400 bytes):
  1. InitializeLauncherPda — creates PDA ["launcher", authority]
  2. CreateAssociatedTokenAccount — WSOL ATA for the LauncherPda

Launch tx (uses ALTs to stay under Solana's transaction size limit):
  1. ComputeBudget.setComputeUnitLimit(1.2M)
  2. CreateTokenAndLaunchAccount — mints 1B Token-2022, stores metadata
  3. InitializeLaunchState — records the token as a normal Hatch launch (`LAUNCH_MODE_NORMAL`)
  4. CreatePoolAndLockedPosition — creates DLMM pair + locked 70-bin position
```

**Normal subsequent launches (1 transaction):**

LauncherPda and WSOL ATA already exist, so the setup tx is skipped.

**CTO launch (2-3 transactions):**

```
Optional setup tx, only for first launch from a wallet:
  1. InitializeLauncherPda
  2. CreateAssociatedTokenAccount — WSOL ATA for the LauncherPda

CTO token/staking setup tx:
  1. ComputeBudget.setComputeUnitLimit(1.2M)
  2. CreateTokenAndLaunchAccount
  3. InitializeLaunchState — records `LAUNCH_MODE_CTO`
  4. InitializeCtoStakePool
  5. InitializeCtoFeeVaultX
  6. InitializeCtoFeeVaultY

Pool tx:
  1. ComputeBudget.setComputeUnitLimit(1.2M)
  2. CreatePoolAndLockedPosition — validates CTO stake pool as remaining account
```

**Claim tx (uses ALTs):**

```
  1. ComputeBudget.setComputeUnitLimit(1.4M)
  2. CreateAssociatedTokenAccount (idempotent) — treasury WSOL ATA
  3. CreateAssociatedTokenAccount (idempotent) — signer WSOL ATA
  4. InitPoolFeeAccount (if not yet initialized)
  5. ClaimFeeManual — claims fees, validates launch state, burns token side, splits WSOL
```

### On-chain accounts

| Account | Derivation | Purpose |
|---|---|---|
| LauncherPda | `PDA["launcher", authority]` | Owns all positions for this wallet. Stores referrer. One per wallet, created on first launch. |
| LaunchTokenAccount | `PDA["launch-token", mint, launcherPda]` | Holds the 30% reserve supply. |
| LaunchState | `PDA["launch-state", mint]` | Records immutable launch mode: normal or CTO. Older launches without this account remain supported by the on-chain program as normal mode. |
| PoolFeeAccount | `PDA["pool_fees", launcherPda, lbPair]` | Accumulates WSOL fees before claim. |
| ReferrerFeeAccount | `PDA["referrer_fees", referrerLauncherPda]` | Accumulates the referrer's 4% share. |
| CtoStakePool | `PDA["cto-stake-pool", launchState]` | Tracks total staked and reward accumulators for CTO launches. |
| CtoStakeVault | `PDA["cto-stake-vault", stakePool]` | Holds staked launched tokens. |
| CtoFeeVaultX | `PDA["cto-fee-vault-x", stakePool]` | Holds launched-token rewards for CTO stakers. |
| CtoFeeVaultY | `PDA["cto-fee-vault-y", stakePool]` | Holds WSOL rewards for CTO stakers. |
| UserStake | `PDA["user-stake", stakePool, user]` | Stores each staker's amount, fee debt, and pending rewards. |

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `VersionedTransaction too large: 1261 bytes` | Old SDK version bundled all ixs in one tx | Upgrade to latest `main` — the SDK now splits setup and launch into separate txs |
| CTO launch sends multiple transactions | CTO setup has extra stake-pool/vault accounts | Expected. Use `dryRun: true` and your own bundle sender if you need atomic execution. |
| `getCtoStakingStatus()` returns `isCto: false` | Mint has no CTO LaunchState | Confirm the mint was launched with `launchMode: LAUNCH_MODE_CTO`. |
| Staking claim returns 0 | No fees have been distributed since you staked, or rewards were already claimed | Run `getCtoStakingStatus()` and check pending raw fields. |
| `No claimable positions found for mint ...` | Signer's LauncherPda doesn't own a position for that mint | Check `getLaunchStatus({ mint })` — are you using the right signer? |
| `Insufficient funds` or simulation failure on `launch()` | Signer wallet balance too low | Fund with ~0.3 SOL |
| Transaction simulation fails with compute budget error | CU limit too low for this specific pool state | Pass `launchComputeUnitLimit` / `claimComputeUnitLimit` in `HatchClient` config |
| RPC timeouts or 429 errors | Public RPC rate-limited | Use a paid RPC provider (Helius, QuickNode, Triton) |
| Token shows broken image in Phantom / Solscan | Metadata `image` URL is unreachable | Image must be on a permanent, public URL. The on-chain URI is immutable — you'll need to relaunch with a fixed URI. |
| `bigint: Failed to load bindings, pure JS will be used` | Native `bigint-buffer` module not compiled | Harmless warning. Does not affect functionality. Run `pnpm approve-builds` then `pnpm rebuild` if you want to suppress it. |

---

## Agent Safety

This SDK is intended to be safe for launcher-side agents, but agents still need strong operational guardrails.

- Scope: keep the public SDK limited to launcher-safe flows only. Do not ask agents to call rebalance/admin instructions from a different code path.
- Signer handling: use a dedicated hot wallet with a tight SOL balance. Never give an agent your primary treasury or personal wallet.
- Version pinning: install from a tag or commit SHA, not from a moving branch.
- Simulation first: agents should default to `dryRun: true` or RPC simulation before asking for a live signature.
- Human-readable summaries: before a user signs, the agent should summarize the mint, referrer, fee tier, setup requirement, and expected account creations.
- Cluster checks: configure the RPC URL explicitly and have agents display the target cluster before sending.
- Immutable actions: agents should warn that launch metadata URI and first-launch referrer assignment are effectively one-way decisions.
- Referrer setup: if an agent is operating for a referrer, initialize the referrer fee account before referred launches start claiming fees.
- Review low-level builders carefully: the high-level client is safer for agents than assembling arbitrary instruction bundles by hand.

Open sourcing this SDK does not create new permissions by itself. It mainly makes the existing launcher flow easier to automate. The main risks are user footguns, bad agent behavior, and supply-chain/version drift, not new on-chain authority.

---

## Security

- An agent using this SDK needs your **signing keypair**. Only use a dedicated, limited-balance hot wallet for agent automation. Never hand your main wallet's keypair to an agent you didn't write.
- The signer wallet pays for all on-chain rent and fees. Fund it with only as much SOL as you plan to use.
- The SDK does not transmit your keypair anywhere — all signing happens locally.
- Open-source availability does not grant anyone new permissions. Any real value-moving action still requires the user's signer.
- Review the source code. It's MIT-licensed and fully readable.

## Support

Open a GitHub issue. Best-effort, no SLA.

## License

MIT
