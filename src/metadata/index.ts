export type HatchMetadataFile = {
  uri: string;
  type: string;
};

export type HatchMetadataExtensions = {
  twitter?: string;
  website?: string;
  telegram?: string;
};

/**
 * Canonical off-chain token metadata JSON used by Hatch launches.
 *
 * The on-chain Token-2022 metadata stores only name, symbol, and uri. The uri
 * should point to a JSON document with this shape so web-launched and SDK-launched
 * tokens render consistently in wallets, explorers, and Hatch UI.
 *
 * Keep the canonical shape intentionally small. Social links live in `extensions`.
 * `properties.files` and `animation_url` are optional compatibility fields for
 * consumers that understand Metaplex-style richer media metadata.
 */
export type HatchTokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  /** Direct public URL to the token icon/preview image. */
  image: string;
  /** Optional richer media URL. Prefer a static image thumbnail in `image`. */
  animation_url?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
  properties?: {
    files?: HatchMetadataFile[];
  };
  extensions?: HatchMetadataExtensions;
};

export type BuildHatchMetadataParams = {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
  /** Optional compatibility media file entry. Usually not needed for fungible token icons. */
  file?: HatchMetadataFile;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Build canonical Hatch metadata with first-class social link support. */
export function buildHatchTokenMetadata(params: BuildHatchMetadataParams): HatchTokenMetadata {
  const metadata: HatchTokenMetadata = {
    name: params.name,
    symbol: params.symbol,
    description: params.description ?? "",
    image: params.image ?? "",
  };

  if (params.external_url !== undefined && params.external_url.length > 0) {
    metadata.external_url = params.external_url;
  }
  if (params.attributes !== undefined && params.attributes.length > 0) {
    metadata.attributes = params.attributes;
  }

  const extensions: HatchMetadataExtensions = {};
  if (params.twitter !== undefined && params.twitter.length > 0) extensions.twitter = params.twitter;
  if (params.website !== undefined && params.website.length > 0) extensions.website = params.website;
  if (params.telegram !== undefined && params.telegram.length > 0) extensions.telegram = params.telegram;
  if (Object.keys(extensions).length > 0) metadata.extensions = extensions;

  if (params.file !== undefined) {
    metadata.properties = { files: [params.file] };
  }

  return metadata;
}

export function validateHatchTokenMetadata(metadata: unknown): string[] {
  const issues: string[] = [];

  if (!isRecord(metadata)) return ["Metadata must be a JSON object."];

  if (typeof metadata.name !== "string" || metadata.name.trim().length === 0) {
    issues.push("Missing or invalid `name`.");
  } else if (metadata.name.length > 32) {
    issues.push("`name` must be 32 characters or less.");
  }

  if (typeof metadata.symbol !== "string" || metadata.symbol.trim().length === 0) {
    issues.push("Missing or invalid `symbol`.");
  } else if (metadata.symbol.length > 10) {
    issues.push("`symbol` must be 10 characters or less.");
  }

  if (typeof metadata.description !== "string") {
    issues.push("Missing or invalid `description`; use an empty string if omitted.");
  }

  if (typeof metadata.image !== "string") {
    issues.push("Missing or invalid `image`; use an empty string or a direct public HTTP(S) media URL.");
  } else if (metadata.image.length > 0 && !isHttpUrl(metadata.image)) {
    issues.push("`image` must be a direct public HTTP(S) media URL when present.");
  }

  if (metadata.animation_url !== undefined) {
    if (typeof metadata.animation_url !== "string" || !isHttpUrl(metadata.animation_url)) {
      issues.push("`animation_url` must be a public HTTP(S) URL when provided.");
    }
  }

  if (metadata.extensions !== undefined) {
    if (!isRecord(metadata.extensions)) {
      issues.push("`extensions` must be an object when provided.");
    } else {
      for (const key of Object.keys(metadata.extensions)) {
        if (key !== "twitter" && key !== "website" && key !== "telegram") {
          issues.push(`Unsupported extensions.${key}; expected twitter, website, or telegram.`);
        }
      }

      for (const key of ["twitter", "website", "telegram"] as const) {
        const value = metadata.extensions[key];
        if (value !== undefined) {
          if (typeof value !== "string") {
            issues.push(`extensions.${key} must be a string when provided.`);
          } else if (value.length > 0 && !isHttpUrl(value)) {
            issues.push(`extensions.${key} must be a public HTTP(S) URL when provided.`);
          }
        }
      }
    }
  }

  if (metadata.properties !== undefined) {
    if (!isRecord(metadata.properties)) {
      issues.push("`properties` must be an object when provided.");
    } else if (metadata.properties.files !== undefined) {
      if (!Array.isArray(metadata.properties.files)) {
        issues.push("`properties.files` must be an array when provided.");
      } else {
        for (const [index, file] of metadata.properties.files.entries()) {
          if (!isRecord(file)) {
            issues.push(`properties.files[${index}] must be an object.`);
            continue;
          }
          if (typeof file.uri !== "string" || !isHttpUrl(file.uri)) {
            issues.push(`properties.files[${index}].uri must be a public HTTP(S) URL.`);
          }
          if (typeof file.type !== "string" || file.type.length === 0) {
            issues.push(`properties.files[${index}].type must be a non-empty string.`);
          }
        }
      }
    }
  }

  return issues;
}
