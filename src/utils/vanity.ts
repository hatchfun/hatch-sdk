import { Keypair } from "@solana/web3.js";

export const DEFAULT_LAUNCH_MINT_SUFFIX = "EGG";

export type GenerateVanityKeypairOptions = {
  /** Base58 suffix the generated public key must end with. Defaults to `EGG`. */
  suffix?: string;
  /** Whether suffix matching is case-sensitive. Defaults to true. */
  caseSensitive?: boolean;
  /** Yield to the event loop every N attempts. Defaults to 10,000. */
  yieldEvery?: number;
  /** Optional abort signal for callers that want to cancel a grind. */
  signal?: AbortSignal;
};

export type VanityKeypairResult = {
  keypair: Keypair;
  attempts: number;
  elapsedMs: number;
};

function normalizeSuffix(suffix: string, caseSensitive: boolean): string {
  return caseSensitive ? suffix : suffix.toUpperCase();
}

function matchesSuffix(address: string, suffix: string, caseSensitive: boolean): boolean {
  const candidate = caseSensitive ? address : address.toUpperCase();
  return candidate.endsWith(suffix);
}

function validateSuffix(suffix: string): void {
  if (suffix.length === 0) {
    throw new Error("Vanity suffix must be non-empty.");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Generate a Solana keypair whose public key ends with the requested base58 suffix.
 *
 * Hatch web launches use an `EGG` suffix for token mints. The SDK exposes the
 * same grinder so SDK launches can follow the same convention.
 */
export async function generateVanityKeypair(
  options: GenerateVanityKeypairOptions = {},
): Promise<VanityKeypairResult> {
  const suffix = options.suffix ?? DEFAULT_LAUNCH_MINT_SUFFIX;
  const caseSensitive = options.caseSensitive ?? true;
  const target = normalizeSuffix(suffix, caseSensitive);
  const yieldEvery = options.yieldEvery ?? 10_000;
  validateSuffix(target);

  const startedAt = Date.now();
  let attempts = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw new Error("Vanity keypair generation aborted.");
    }

    const keypair = Keypair.generate();
    attempts++;

    if (matchesSuffix(keypair.publicKey.toBase58(), target, caseSensitive)) {
      return {
        keypair,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (yieldEvery > 0 && attempts % yieldEvery === 0) {
      await yieldToEventLoop();
    }
  }
}
