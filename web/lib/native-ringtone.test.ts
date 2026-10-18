/**
 * Lightweight Node-runnable checks for ringtone encoding (no Jest required).
 * Run: npx tsx lib/native-ringtone.test.ts   OR   node --import tsx ...
 * Also runnable via: npx ts-node --esm (if configured)
 *
 * This file is also imported by the self-test script below for CI-less verification.
 */

export async function blobToBase64Node(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export function assertBase64RoundTrip(bytes: Uint8Array): void {
  const b64 = Buffer.from(bytes).toString("base64");
  const back = Buffer.from(b64, "base64");
  if (back.length !== bytes.length) {
    throw new Error(`length mismatch ${back.length} vs ${bytes.length}`);
  }
  for (let i = 0; i < bytes.length; i++) {
    if (back[i] !== bytes[i]) throw new Error(`byte mismatch at ${i}`);
  }
}
