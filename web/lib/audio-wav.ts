/** Encode an AudioBuffer as a 16-bit mono/stereo WAV Blob (decodeAudioData-friendly). */

export type WavEncodeOptions = {
  /** Peak-normalize toward ~−1 dBFS for consistent playback loudness */
  normalize?: boolean;
};

/** Merge captured mono PCM chunks into a WAV blob (alarm-safe, always decodable). */
export function float32ChunksToWavBlob(
  chunks: Float32Array[],
  sampleRate: number,
  options: WavEncodeOptions = {},
): Blob | null {
  if (!chunks.length || sampleRate < 1) return null;
  const length = chunks.reduce((n, c) => n + c.length, 0);
  if (length < 1) return null;
  const channel = new Float32Array(length);
  let writeAt = 0;
  for (const chunk of chunks) {
    channel.set(chunk, writeAt);
    writeAt += chunk.length;
  }

  if (options.normalize !== false) {
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const a = Math.abs(channel[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0.0001 && peak < 0.99) {
      const gain = 0.92 / peak;
      for (let i = 0; i < length; i++) channel[i] *= gain;
    }
  }

  const numChannels = 1;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const samples = buffer.length;
  const dataSize = samples * blockAlign;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(ab);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

/** Decode any playable blob via AudioContext; returns null if unsupported. */
export async function decodeToAudioBuffer(
  blob: Blob,
  sharedCtx?: AudioContext | null,
): Promise<AudioBuffer | null> {
  if (typeof window === "undefined" || blob.size < 1) return null;
  const raw = await blob.arrayBuffer();
  if (sharedCtx) {
    try {
      if (sharedCtx.state === "suspended") await sharedCtx.resume().catch(() => undefined);
      return await sharedCtx.decodeAudioData(raw.slice(0));
    } catch {
      /* fall through to throwaway context */
    }
  }
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  try {
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    return await ctx.decodeAudioData(raw.slice(0));
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Prefer WAV so alarm-time decode always works (webm often fails without a user gesture). */
export async function toPlayableVoiceBlob(
  blob: Blob,
  mimeType?: string,
  sharedCtx?: AudioContext | null,
): Promise<{
  blob: Blob;
  mimeType: string;
}> {
  if (/wav/i.test(mimeType || blob.type || "")) {
    return { blob, mimeType: "audio/wav" };
  }
  const decoded = await decodeToAudioBuffer(blob, sharedCtx);
  if (decoded) {
    return { blob: audioBufferToWavBlob(decoded), mimeType: "audio/wav" };
  }
  return {
    blob: blob.slice(0, blob.size, mimeType || blob.type || "audio/webm"),
    mimeType: mimeType || blob.type || "audio/webm",
  };
}
