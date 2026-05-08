import { createHash } from "crypto";

export function getInstructionDiscriminator(instructionName: string): Buffer {
  const hash = createHash("sha256").update(`global:${instructionName}`).digest();
  return hash.subarray(0, 8);
}
