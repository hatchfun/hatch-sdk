import { readFileSync } from "node:fs";
import { validateHatchTokenMetadata } from "../src/metadata";

async function loadMetadata(input: string): Promise<{ metadata: unknown; source: string }> {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata URL: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const metadata = await response.json();
    return {
      metadata,
      source: `${input} (${contentType || "unknown content-type"})`,
    };
  }

  const raw = readFileSync(input, "utf-8");
  return {
    metadata: JSON.parse(raw),
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
  const issues = validateHatchTokenMetadata(metadata);

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
  console.log("- `image` inside the JSON should be the direct token icon/preview URL.");
  console.log("- Social links should be placed under `extensions`.");
}

main().catch((err) => {
  console.error("Metadata validation failed:");
  console.error(err);
  process.exit(1);
});
