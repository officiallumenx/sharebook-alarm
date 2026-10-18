import {
  type VoicePersona,
  personaSpeechParams,
  resolveVoice,
  waitForVoices,
} from "./voices";
import { audioBufferToWavBlob, decodeToAudioBuffer } from "./audio-wav";
import { getVoiceClip, saveVoiceClip } from "./voice-clips";
import { getRingtone } from "./ringtones";
import { isBeepSound, isNatureSound } from "./alarm-sounds";

export class AudioSynthesizer {
  ctx: AudioContext | null = null;
  alarmInterval: ReturnType<typeof setInterval> | null = null;
  voiceTimeout: ReturnType<typeof setTimeout> | null = null;
  birdInterval: ReturnType<typeof setInterval> | null = null;
  bgGain: GainNode | null = null;
  isRinging = false;
  voicesReady = false;
  /** Bumps on every start/stop so async audio work cannot attach to a newer session. */
  private generation = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private speechSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private birdChirpTimers: Array<ReturnType<typeof setTimeout>> = [];
  private recordingAudio: HTMLAudioElement | null = null;
  private recordingUrl: string | null = null;
  private ringtoneAudio: HTMLAudioElement | null = null;
  private ringtoneUrl: string | null = null;
  private customSource: AudioBufferSourceNode | null = null;
  private customGain: GainNode | null = null;
  private voiceNodes: AudioNode[] = [];
  private pulseNodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private natureNodes: AudioNode[] = [];
  private ambientLevel = 0.2;
  /** Reused white-noise buffer so nature beds don't freeze the UI regenerating samples. */
  private noiseBuffer: AudioBuffer | null = null;
  /** Warm decode cache so alarm-time voice works without a fresh user gesture. */
  private voiceBufferCache = new Map<string, AudioBuffer>();
  private static readonly VOICE_CACHE_MAX = 6;
  /** Near-silent loop so mobile browsers are less likely to freeze the tab when screen is off. */
  private keepaliveSource: OscillatorNode | null = null;
  private keepaliveGain: GainNode | null = null;
  /** One-shot My Voices / picker preview (separate from alarm generation). */
  private previewSource: AudioBufferSourceNode | null = null;
  private previewGen = 0;

  private isActive(gen: number) {
    return this.isRinging && this.generation === gen;
  }

  /** Drop a warm-decoded clip (call when the user deletes a recording). */
  evictVoiceClip(recordingId: string) {
    const id = recordingId?.trim();
    if (!id) return;
    this.voiceBufferCache.delete(id);
  }

  private stopOneShotPreview() {
    this.previewGen += 1;
    if (this.previewSource) {
      try {
        this.previewSource.stop();
      } catch {
        /* ignore */
      }
      try {
        this.previewSource.disconnect();
      } catch {
        /* ignore */
      }
      this.previewSource = null;
    }
    this.clearRecordingAudio();
  }

  /** True when an alarm (not a short ringtone preview) is currently looping. */
  private isAlarmRingActive() {
    return this.isRinging && !this.previewTimer;
  }

  /** Start after a user gesture when background alarms are armed. */
  startKeepaliveBed() {
    try {
      this.init();
      if (!this.ctx || this.keepaliveSource) return;
      // Cheap oscillator keepalive (no buffer fill / no ScriptProcessor)
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 20;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.00035;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.keepaliveSource = osc;
      this.keepaliveGain = gain;
      void this.ctx.resume().catch(() => undefined);
    } catch (e) {
      console.warn("keepalive failed", e);
    }
  }

  private rememberVoiceBuffer(id: string, buffer: AudioBuffer) {
    if (this.voiceBufferCache.has(id)) this.voiceBufferCache.delete(id);
    this.voiceBufferCache.set(id, buffer);
    while (this.voiceBufferCache.size > AudioSynthesizer.VOICE_CACHE_MAX) {
      const oldest = this.voiceBufferCache.keys().next().value;
      if (oldest == null) break;
      this.voiceBufferCache.delete(oldest);
    }
  }

  stopKeepaliveBed() {
    if (this.keepaliveSource) {
      try {
        this.keepaliveSource.stop();
      } catch {
        /* ignore */
      }
      try {
        this.keepaliveSource.disconnect();
      } catch {
        /* ignore */
      }
      this.keepaliveSource = null;
    }
    if (this.keepaliveGain) {
      try {
        this.keepaliveGain.disconnect();
      } catch {
        /* ignore */
      }
      this.keepaliveGain = null;
    }
  }

  /** Decode + cache a clip (call from Play / save while user gesture is active). */
  async warmVoiceClip(recordingId: string): Promise<boolean> {
    const id = recordingId?.trim();
    if (!id) return false;
    if (this.voiceBufferCache.has(id)) return true;
    try {
      const clip = await getVoiceClip(id);
      if (!clip?.blob?.size) return false;
      await this.prime();
      let decoded: AudioBuffer | null = null;
      try {
        if (this.ctx) {
          const raw = await clip.blob.arrayBuffer();
          decoded = await this.ctx.decodeAudioData(raw.slice(0));
        }
      } catch {
        decoded = null;
      }
      if (!decoded) {
        decoded = await decodeToAudioBuffer(clip.blob, this.ctx);
      }
      if (!decoded) return false;
      this.rememberVoiceBuffer(id, decoded);

      // Migrate old webm/mp4 clips to WAV so future alarm rings always decode
      if (!/wav/i.test(clip.mimeType || clip.blob.type || "")) {
        try {
          await saveVoiceClip({
            ...clip,
            blob: audioBufferToWavBlob(decoded),
            mimeType: "audio/wav",
            durationMs: Math.round(decoded.duration * 1000),
          });
        } catch {
          /* ignore migration errors */
        }
      }
      return true;
    } catch (e) {
      console.warn("warmVoiceClip failed", id, e);
      return false;
    }
  }

  async prime() {
    this.init();
    if (this.ctx?.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
    void this.ensureVoices();
  }

  init() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    void this.ensureVoices();
  }

  async ensureVoices() {
    if (this.voicesReady) return;
    await waitForVoices();
    this.voicesReady = true;
  }

  playClick() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch (e) {
      console.error(e);
    }
  }

  duckBackground(duration = 0.08) {
    if (!this.bgGain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.bgGain.gain.cancelScheduledValues(now);
      this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, now);
      this.bgGain.gain.linearRampToValueAtTime(0.05, now + duration);
    } catch {
      /* ignore */
    }
    if (this.ringtoneAudio) {
      this.ringtoneAudio.volume = 0.2;
    }
  }

  restoreBackground(level = this.ambientLevel, duration = 0.12) {
    if (!this.bgGain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.bgGain.gain.cancelScheduledValues(now);
      this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, now);
      this.bgGain.gain.linearRampToValueAtTime(level, now + duration);
    } catch {
      /* ignore */
    }
    if (this.ringtoneAudio) {
      this.ringtoneAudio.volume = 0.85;
    }
  }

  private clearPulseNodes() {
    for (const node of this.pulseNodes) {
      try {
        node.osc.stop();
      } catch {
        /* ignore */
      }
      try {
        node.osc.disconnect();
        node.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.pulseNodes = [];
  }

  private clearNature() {
    if (this.birdInterval) {
      clearInterval(this.birdInterval);
      this.birdInterval = null;
    }
    for (const t of this.birdChirpTimers) clearTimeout(t);
    this.birdChirpTimers = [];
    for (const node of this.natureNodes) {
      try {
        if ("stop" in node && typeof (node as AudioBufferSourceNode).stop === "function") {
          (node as AudioBufferSourceNode).stop();
        }
      } catch {
        /* ignore */
      }
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.natureNodes = [];
  }

  private getNoiseBuffer() {
    if (!this.ctx) return null;
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === this.ctx.sampleRate) {
      return this.noiseBuffer;
    }
    // ~0.8s is enough for a seamless loop and cheap to build once
    const seconds = 0.8;
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private startNoiseBed(options: {
    level: number;
    type: BiquadFilterType;
    frequency: number;
    Q?: number;
    lfoRate?: number;
    lfoDepth?: number;
  }) {
    if (!this.ctx || !this.bgGain) return;
    const buffer = this.getNoiseBuffer();
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.value = options.frequency;
    if (options.Q) filter.Q.value = options.Q;
    const gain = this.ctx.createGain();
    gain.gain.value = options.level;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.bgGain);
    src.start();
    this.natureNodes.push(src, filter, gain);

    if (options.lfoRate && options.lfoDepth) {
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = options.lfoRate;
      lfoGain.gain.value = options.lfoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();
      this.natureNodes.push(lfo, lfoGain);
    }
  }

  private scheduleBirdChirp(delayMs: number, gen: number) {
    const t = setTimeout(() => {
      if (this.isActive(gen)) this.chirpBird(gen);
    }, delayMs);
    this.birdChirpTimers.push(t);
  }

  private chirpBird(gen = this.generation) {
    if (!this.isActive(gen) || !this.ctx || !this.bgGain) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startF = 1800 + Math.random() * 1400;
      const endF = startF + 400 + Math.random() * 800;
      osc.type = "sine";
      osc.frequency.setValueAtTime(startF, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(200, endF), now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.bgGain);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      /* ignore */
    }
  }

  private startNatureLoop(soundType: string, gen: number) {
    if (!this.ctx || !this.bgGain || !this.isActive(gen)) return;
    if (soundType === "waterfall") {
      this.startNoiseBed({ level: 0.22, type: "bandpass", frequency: 900, Q: 0.7 });
      this.startNoiseBed({ level: 0.1, type: "highpass", frequency: 2200, Q: 0.5 });
    } else if (soundType === "rain") {
      this.startNoiseBed({ level: 0.16, type: "highpass", frequency: 1800, Q: 0.6 });
    } else if (soundType === "ocean") {
      this.startNoiseBed({
        level: 0.18,
        type: "lowpass",
        frequency: 480,
        Q: 0.8,
        lfoRate: 0.12,
        lfoDepth: 0.08,
      });
    } else if (soundType === "forest") {
      this.startNoiseBed({ level: 0.08, type: "lowpass", frequency: 700, Q: 0.5 });
      this.chirpBird(gen);
      this.birdInterval = setInterval(() => {
        if (!this.isActive(gen)) return;
        if (Math.random() > 0.35) this.chirpBird(gen);
        if (Math.random() > 0.7) this.scheduleBirdChirp(120, gen);
      }, 900);
    } else if (soundType === "birds") {
      this.startNoiseBed({ level: 0.04, type: "lowpass", frequency: 500, Q: 0.4 });
      this.chirpBird(gen);
      this.birdInterval = setInterval(() => {
        if (!this.isActive(gen)) return;
        this.chirpBird(gen);
        if (Math.random() > 0.5) this.scheduleBirdChirp(90 + Math.random() * 160, gen);
      }, 700);
    }
  }

  private startBeepLoop(soundType: string, soft: boolean, gen: number) {
    const triggerBgPulse = () => {
      if (!this.isActive(gen) || !this.ctx || !this.bgGain) return;
      try {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        if (soundType === "gentle") {
          osc.type = "sine";
          osc.frequency.setValueAtTime(261.63, now);
          osc.frequency.exponentialRampToValueAtTime(329.63, now + 0.3);
        } else if (soundType === "chime") {
          osc.type = "triangle";
          osc.frequency.setValueAtTime(349.23, now);
          osc.frequency.exponentialRampToValueAtTime(440, now + 0.25);
        } else {
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
        }

        const peak = soft ? 0.1 : 0.22;
        gain.gain.setValueAtTime(peak, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(gain);
        gain.connect(this.bgGain);
        osc.start(now);
        osc.stop(now + 0.42);
        this.pulseNodes.push({ osc, gain });
        if (this.pulseNodes.length > 8) {
          const old = this.pulseNodes.shift();
          try {
            old?.osc.disconnect();
            old?.gain.disconnect();
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    triggerBgPulse();
    this.alarmInterval = setInterval(triggerBgPulse, 900);
  }

  private ensureBedGain() {
    if (!this.ctx) return;
    if (!this.bgGain) {
      this.bgGain = this.ctx.createGain();
      this.bgGain.gain.setValueAtTime(this.ambientLevel, this.ctx.currentTime);
      this.bgGain.connect(this.ctx.destination);
    }
  }

  /** Prefer Web Audio buffer loop — HTMLAudio is often blocked when alarms fire without a click. */
  private async startCustomRingtone(ringtoneId: string, gen: number) {
    await this.prime();
    if (!this.isActive(gen)) return;
    const id = ringtoneId.trim();
    // Do not scan the whole ringtone library here — that can freeze the UI
    if (!id || !this.isActive(gen)) {
      if (this.isActive(gen)) this.startBeepLoop("digital", false, gen);
      return;
    }

    const tone = await getRingtone(id);
    if (!tone || !this.isActive(gen) || !this.ctx) {
      if (this.isActive(gen)) this.startBeepLoop("digital", false, gen);
      return;
    }

    this.clearRingtoneAudio();
    this.ensureBedGain();
    if (!this.bgGain || !this.isActive(gen)) return;

    try {
      const raw = await tone.blob.arrayBuffer();
      if (!this.isActive(gen) || !this.ctx) return;
      const decoded = await this.ctx.decodeAudioData(raw.slice(0));
      if (!this.isActive(gen) || !this.bgGain) return;

      const src = this.ctx.createBufferSource();
      src.buffer = decoded;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain);
      gain.connect(this.bgGain);
      src.start();
      this.customSource = src;
      this.customGain = gain;
      return;
    } catch (e) {
      console.error("Custom ringtone decode failed, trying HTMLAudio", e);
    }

    if (!this.isActive(gen)) return;

    // Fallback for formats the browser cannot decode into an AudioBuffer
    this.ringtoneUrl = URL.createObjectURL(tone.blob);
    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 0.85;
    audio.src = this.ringtoneUrl;
    this.ringtoneAudio = audio;
    try {
      if (this.ctx && this.bgGain) {
        const mediaSrc = this.ctx.createMediaElementSource(audio);
        mediaSrc.connect(this.bgGain);
        this.natureNodes.push(mediaSrc);
      }
      await audio.play();
    } catch (err) {
      console.error(err);
      try {
        await audio.play();
      } catch {
        this.clearRingtoneAudio();
        if (this.isActive(gen)) this.startBeepLoop("digital", false, gen);
      }
    }
  }

  /** Preview a built-in or custom sound briefly. */
  async previewSound(soundType: string, customRingtoneId?: string) {
    if (this.isAlarmRingActive()) return;
    this.stopOneShotPreview();
    this.stopAlarmLoop();
    const gen = ++this.generation;
    await this.prime();
    if (this.generation !== gen) return;
    this.isRinging = true;
    this.ambientLevel = 0.22;
    this.ensureBedGain();
    if (soundType === "custom") {
      await this.startCustomRingtone(customRingtoneId || "", gen);
    } else if (isNatureSound(soundType)) {
      this.startNatureLoop(soundType, gen);
    } else {
      this.startBeepLoop(soundType || "digital", false, gen);
    }
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      if (this.generation === gen && this.isRinging) this.stopAlarmLoop();
    }, 3500);
  }

  async startAlarmLoop(
    soundType = "digital",
    voiceText = "",
    voiceType: VoicePersona = "female",
    voiceURI?: string,
    recordingId?: string,
    customRingtoneId?: string,
  ) {
    this.stopAlarmLoop();
    const gen = ++this.generation;
    this.init();
    await this.prime();
    if (this.generation !== gen) return;
    this.isRinging = true;

    const softBed = Boolean(recordingId) || isNatureSound(soundType) || soundType === "custom";
    this.ambientLevel = softBed ? 0.16 : 0.22;
    this.ensureBedGain();

    if (soundType === "custom") {
      await this.startCustomRingtone(customRingtoneId || "", gen);
    } else if (isNatureSound(soundType)) {
      this.startNatureLoop(soundType, gen);
    } else if (isBeepSound(soundType) || !soundType) {
      this.startBeepLoop(soundType || "digital", Boolean(recordingId), gen);
    } else {
      this.startBeepLoop("digital", Boolean(recordingId), gen);
    }

    if (!this.isActive(gen)) return;

    // Recorded voice over the ringtone bed (label optional).
    // Warm + start immediately so we don't miss the first ring after a reload.
    if (recordingId) {
      const clipId = recordingId.trim();
      try {
        await this.warmVoiceClip(clipId);
      } catch {
        /* continue — runRecordingLoop has its own fallbacks */
      }
      if (!this.isActive(gen)) return;
      this.voiceTimeout = setTimeout(() => {
        void this.runRecordingLoop(clipId, gen).catch((e) =>
          console.error("Voice loop failed", e),
        );
      }, 220);
      return;
    }

    const speak = voiceText.trim();
    if (speak) {
      this.runVoiceLoop(speak, voiceType, voiceURI, gen);
    }
  }

  private clearVoiceNodes() {
    for (const node of this.voiceNodes) {
      try {
        if ("stop" in node && typeof (node as AudioBufferSourceNode).stop === "function") {
          (node as AudioBufferSourceNode).stop();
        }
      } catch {
        /* ignore */
      }
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.voiceNodes = [];
  }

  private playDecodedVoiceLoop(decoded: AudioBuffer, gen: number) {
    const playBuffer = () => {
      if (!this.isActive(gen) || !this.ctx) return;
      this.clearVoiceNodes();
      this.duckBackground(0.08);
      const src = this.ctx.createBufferSource();
      src.buffer = decoded;

      // Light speech EQ so recorded voice stays intelligible over the bed
      const highpass = this.ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 90;
      highpass.Q.value = 0.7;
      const presence = this.ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 3000;
      presence.Q.value = 0.85;
      presence.gain.value = 2.2;
      const gain = this.ctx.createGain();
      gain.gain.value = 1.28;

      src.connect(highpass);
      highpass.connect(presence);
      presence.connect(gain);
      gain.connect(this.ctx.destination);
      src.onended = () => {
        if (!this.isActive(gen)) return;
        this.restoreBackground(this.ambientLevel, 0.14);
        this.voiceTimeout = setTimeout(playBuffer, 900);
      };
      try {
        src.start();
        this.voiceNodes.push(src, highpass, presence, gain);
      } catch (e) {
        console.error(e);
        this.voiceTimeout = setTimeout(playBuffer, 400);
      }
    };
    playBuffer();
  }

  private async runRecordingLoop(recordingId: string, gen: number) {
    if (!this.isActive(gen)) return;
    try {
      await this.prime();
      if (this.ctx?.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch {
          /* ignore */
        }
      }
      if (!this.isActive(gen)) return;

      // 1) Warm cache (from earlier Play / save / startAlarmLoop)
      let decoded = this.voiceBufferCache.get(recordingId) || null;

      // 2) Decode from IndexedDB (WAV preferred)
      if (!decoded) {
        const warmed = await this.warmVoiceClip(recordingId);
        if (warmed) decoded = this.voiceBufferCache.get(recordingId) || null;
      }
      if (!decoded) {
        const clip = await getVoiceClip(recordingId);
        if (!clip?.blob?.size) {
          console.warn("Voice clip missing or empty:", recordingId);
          return;
        }
        if (!this.isActive(gen)) return;
        try {
          if (this.ctx) {
            const raw = await clip.blob.arrayBuffer();
            if (!this.isActive(gen) || !this.ctx) return;
            decoded = await this.ctx.decodeAudioData(raw.slice(0));
            this.rememberVoiceBuffer(recordingId, decoded);
          }
        } catch {
          decoded = await decodeToAudioBuffer(clip.blob, this.ctx);
          if (decoded) this.rememberVoiceBuffer(recordingId, decoded);
        }
      }

      if (decoded && this.isActive(gen)) {
        this.playDecodedVoiceLoop(decoded, gen);
        return;
      }

      // 3) Last resort: HTMLAudio (often blocked when alarm fires without a tap)
      const clip = await getVoiceClip(recordingId);
      if (!clip?.blob?.size || !this.isActive(gen) || !this.ctx) return;

      this.clearRecordingAudio();
      this.clearVoiceNodes();
      this.recordingUrl = URL.createObjectURL(clip.blob);
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = this.recordingUrl;
      this.recordingAudio = audio;

      const voiceGain = this.ctx.createGain();
      voiceGain.gain.value = 1.2;
      voiceGain.connect(this.ctx.destination);
      try {
        const mediaSrc = this.ctx.createMediaElementSource(audio);
        mediaSrc.connect(voiceGain);
        this.voiceNodes.push(mediaSrc, voiceGain);
      } catch (e) {
        console.error(e);
        this.voiceNodes.push(voiceGain);
      }

      const playNext = () => {
        if (!this.isActive(gen) || !this.recordingAudio || !this.ctx) return;
        this.duckBackground(0.1);
        this.recordingAudio.currentTime = 0;
        void this.ctx.resume().catch(() => undefined);
        void this.recordingAudio.play().catch((err) => {
          console.error("Voice HTMLAudio play failed", err);
          this.voiceTimeout = setTimeout(playNext, 800);
        });
      };

      audio.onended = () => {
        if (!this.isActive(gen)) return;
        this.restoreBackground(this.ambientLevel, 0.14);
        this.voiceTimeout = setTimeout(playNext, 1200);
      };

      playNext();
    } catch (e) {
      console.error("runRecordingLoop error", e);
    }
  }

  async playRecordingOnce(recordingId: string): Promise<boolean> {
    try {
      if (this.isAlarmRingActive()) return false;
      this.stopOneShotPreview();
      const playGen = this.previewGen;
      const warmed = await this.warmVoiceClip(recordingId);
      if (playGen !== this.previewGen) return false;
      const clip = await getVoiceClip(recordingId);
      if (!clip?.blob || clip.blob.size < 1) return false;
      await this.prime();
      if (playGen !== this.previewGen) return false;

      const decoded = this.voiceBufferCache.get(recordingId);
      if (decoded && this.ctx) {
        return await new Promise<boolean>((resolve) => {
          try {
            const src = this.ctx!.createBufferSource();
            const gain = this.ctx!.createGain();
            gain.gain.value = 1;
            src.buffer = decoded;
            src.connect(gain);
            gain.connect(this.ctx!.destination);
            this.previewSource = src;
            const finish = (ok: boolean) => {
              if (this.previewSource === src) this.previewSource = null;
              resolve(ok);
            };
            src.onended = () => finish(true);
            src.start();
            window.setTimeout(
              () => finish(playGen === this.previewGen),
              Math.min(60_000, decoded.duration * 1000 + 500),
            );
          } catch {
            resolve(false);
          }
        });
      }

      this.clearRecordingAudio();
      this.recordingUrl = URL.createObjectURL(clip.blob);
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = this.recordingUrl;
      this.recordingAudio = audio;
      const played = await new Promise<boolean>((resolve) => {
        let settled = false;
        let safety = 0;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(safety);
          resolve(ok && playGen === this.previewGen);
        };
        safety = window.setTimeout(() => done(true), 60_000);
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        void audio.play().catch(() => done(false));
      });
      if (playGen === this.previewGen) this.clearRecordingAudio();
      return played || warmed;
    } catch {
      this.clearRecordingAudio();
      return false;
    }
  }

  private clearRecordingAudio() {
    if (this.recordingAudio) {
      this.recordingAudio.onended = null;
      this.recordingAudio.pause();
      this.recordingAudio.removeAttribute("src");
      this.recordingAudio.load();
      this.recordingAudio = null;
    }
    if (this.recordingUrl) {
      URL.revokeObjectURL(this.recordingUrl);
      this.recordingUrl = null;
    }
  }

  private clearRingtoneAudio() {
    if (this.customSource) {
      try {
        this.customSource.stop();
      } catch {
        /* ignore */
      }
      try {
        this.customSource.disconnect();
      } catch {
        /* ignore */
      }
      this.customSource = null;
    }
    if (this.customGain) {
      try {
        this.customGain.disconnect();
      } catch {
        /* ignore */
      }
      this.customGain = null;
    }
    if (this.ringtoneAudio) {
      this.ringtoneAudio.onended = null;
      this.ringtoneAudio.pause();
      this.ringtoneAudio.removeAttribute("src");
      this.ringtoneAudio.load();
      this.ringtoneAudio = null;
    }
    if (this.ringtoneUrl) {
      URL.revokeObjectURL(this.ringtoneUrl);
      this.ringtoneUrl = null;
    }
  }

  runVoiceLoop(text: string, voiceType: VoicePersona, voiceURI?: string, gen = this.generation) {
    if (!this.isActive(gen)) return;
    void this.speakSentence(
      text,
      voiceType,
      () => {
        if (!this.isActive(gen)) return;
        this.voiceTimeout = setTimeout(() => {
          if (this.isActive(gen)) this.runVoiceLoop(text, voiceType, voiceURI, gen);
        }, 3500);
      },
      voiceURI,
      gen,
    );
  }

  stopAlarmLoop() {
    this.isRinging = false;
    this.generation += 1;
    this.stopOneShotPreview();
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.voiceTimeout) {
      clearTimeout(this.voiceTimeout);
      this.voiceTimeout = null;
    }
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.speechSafetyTimer) {
      clearTimeout(this.speechSafetyTimer);
      this.speechSafetyTimer = null;
    }
    this.clearRecordingAudio();
    this.clearVoiceNodes();
    this.clearRingtoneAudio();
    this.clearPulseNodes();
    this.clearNature();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this.bgGain && this.ctx) {
      try {
        this.bgGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.bgGain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.bgGain.disconnect();
      } catch {
        /* ignore */
      }
      this.bgGain = null;
    }
  }

  async speakSentence(
    text: string,
    voiceType: VoicePersona = "female",
    onEnd: (() => void) | null = null,
    voiceURI?: string,
    gen = this.generation,
  ) {
    if (!text.trim()) {
      onEnd?.();
      return;
    }

    await this.ensureVoices();
    if (gen !== this.generation) return;

    let handled = false;
    const finish = () => {
      if (handled) return;
      handled = true;
      if (this.speechSafetyTimer) {
        clearTimeout(this.speechSafetyTimer);
        this.speechSafetyTimer = null;
      }
      if (this.isActive(gen)) this.restoreBackground(this.ambientLevel, 0.12);
      if (this.isActive(gen)) onEnd?.();
    };

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      await new Promise((r) => setTimeout(r, 30));
      if (gen !== this.generation) return;

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = resolveVoice(voiceType, voiceURI);
      if (voice) utterance.voice = voice;

      const params = personaSpeechParams(voiceType);
      utterance.pitch = params.pitch;
      utterance.rate = params.rate;
      utterance.lang = voice?.lang || "en-US";

      utterance.onstart = () => {
        if (this.isActive(gen)) this.duckBackground(0.06);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      if (this.speechSafetyTimer) clearTimeout(this.speechSafetyTimer);
      this.speechSafetyTimer = setTimeout(() => {
        this.speechSafetyTimer = null;
        if (!handled) finish();
      }, Math.max(8000, text.length * 70));
      window.speechSynthesis.speak(utterance);
    } else {
      finish();
    }
  }
}

export const audioSynth = new AudioSynthesizer();
