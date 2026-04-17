import { readFileSync } from "node:fs";

type Metadata = {
  name?: unknown;
  symbol?: unknown;
  description?: unknown;
  image?: unknown;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateMetadata(metadata: Metadata): string[] {
  const issues: string[] = [];

  if (typeof metadata.name !== "string" || metadata.name.trim().length === 0) {
    issues.push("Missing or invalid `name`.");
  }
  if (typeof metadata.symbol !== "string" || metadata.symbol.trim().length === 0) {
    issues.push("Missing or invalid `symbol`.");
  }
  if (!isHttpUrl(metadata.image)) {
    issues.push("Missing or invalid `image` URL. Use a direct public HTTP(S) image URL.");
  }
  if (
    metadata.description !== undefined &&
    typeof metadata.description !== "string"
  ) {
    issues.push("`description` must be a string if provided.");
  }

  return issues;
}

async function loadMetadata(input: string): Promise<{ metadata: Metadata; source: string }> {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata URL: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const metadata = (await response.json()) as Metadata;
    return {
      metadata,
      source: `${input} (${contentType || "unknown content-type"})`,
    };
  }

  const raw = readFileSync(input, "utf-8");
  return {
    metadata: JSON.parse(raw) as Metadata,
    source: input,
  };
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: pnpm tsx examples/validate-metadata.ts <metadata-json-path-or-url>");
    process.exit(1);
  }

  const { metadata, source } = await loadMetadata(input);
  const issues = validateMetadata(metadata);

  console.log(`Metadata source: ${source}`);
  console.log(JSON.stringify(metadata, null, 2));

  if (issues.length > 0) {
    console.error("\nMetadata validation failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("\nMetadata validation passed.");
  console.log("- `uri` should be the URL to this JSON file.");
  console.log("- `image` inside the JSON should be the direct image URL.");
}

main().catch((err) => {
  console.error("Metadata validation failed:");
  console.error(err);
  process.exit(1);
});
