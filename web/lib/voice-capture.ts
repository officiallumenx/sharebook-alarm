import { float32ChunksToWavBlob } from "./audio-wav";

/** Mic constraints tuned for spoken voice messages (clarity over call-style processing). */
export const VOICE_MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  sampleSize: { ideal: 16 },
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};

export type PcmCaptureSession = {
  ctx: AudioContext;
  chunks: Float32Array[];
  sampleRate: number;
  /** Stops capture, waits for worklet flush, then tears down audio graph. */
  stop: () => Promise<void>;
};

/**
 * High-quality mono PCM capture via AudioWorklet (preferred) or ScriptProcessor fallback.
 * Applies a light high-pass so speech stays clear without muddy rumble.
 */
export async function startPcmCapture(stream: MediaStream): Promise<PcmCaptureSession | null> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 48000, latencyHint: "interactive" });
  } catch {
    ctx = new AC();
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

  const source = ctx.createMediaStreamSource(stream);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 80;
  highpass.Q.value = 0.7;

  // Gentle speech presence boost
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = 2.5;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.18;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(compressor);

  const chunks: Float32Array[] = [];
  const mute = ctx.createGain();
  mute.gain.value = 0;

  let workletNode: AudioWorkletNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;

  const teardown = () => {
    try {
      workletNode?.disconnect();
      processor?.disconnect();
      compressor.disconnect();
      presence.disconnect();
      highpass.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      /* ignore */
    }
    if (processor) {
      try {
        processor.onaudioprocess = null;
      } catch {
        /* ignore */
      }
    }
    void ctx.close().catch(() => undefined);
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    if (stopped) return Promise.resolve();
    stopped = true;

    stopPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        teardown();
        resolve();
      };

      if (workletNode) {
        const node = workletNode;
        const onMsg = (ev: MessageEvent) => {
          const data = ev.data;
          if (data instanceof Float32Array && data.length) {
            chunks.push(data);
          }
          if (data === "flushed") {
            node.port.removeEventListener("message", onMsg);
            finish();
          }
        };
        node.port.addEventListener("message", onMsg);
        try {
          node.port.postMessage("stop");
        } catch {
          node.port.removeEventListener("message", onMsg);
          finish();
          return;
        }
        // Failsafe if worklet never acks
        setTimeout(() => {
          node.port.removeEventListener("message", onMsg);
          finish();
        }, 120);
        return;
      }

      finish();
    });

    return stopPromise;
  };

  try {
    await ctx.audioWorklet.addModule("/voice-capture-processor.js");
    workletNode = new AudioWorkletNode(ctx, "voice-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    workletNode.port.onmessage = (ev) => {
      if (stopped) return;
      const data = ev.data;
      if (data instanceof Float32Array && data.length) {
        chunks.push(data);
      }
    };
    compressor.connect(workletNode);
    workletNode.connect(mute);
    mute.connect(ctx.destination);
  } catch {
    // ScriptProcessor fallback (older browsers) — larger buffer = fewer main-thread callbacks
    processor = ctx.createScriptProcessor(8192, 1, 1);
    processor.onaudioprocess = (e) => {
      if (stopped) return;
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    compressor.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
  }

  return {
    ctx,
    chunks,
    sampleRate: ctx.sampleRate,
    stop,
  };
}

/** Build a normalized 16-bit WAV from captured PCM (peak ~ −1 dBFS). */
export function pcmSessionToWav(session: {
  chunks: Float32Array[];
  sampleRate: number;
}): Blob | null {
  return float32ChunksToWavBlob(session.chunks, session.sampleRate, { normalize: true });
}

export function pickHighQualityRecorderOptions(mimeType: string): MediaRecorderOptions {
  const opts: MediaRecorderOptions = {};
  if (mimeType) opts.mimeType = mimeType;
  // High bitrate for fallback webm/mp4 when PCM path is unavailable
  opts.audioBitsPerSecond = 256_000;
  return opts;
}
