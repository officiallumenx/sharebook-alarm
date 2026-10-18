/* Off-main-thread PCM capture — batches frames to cut postMessage overhead */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(4096);
    this._offset = 0;
    this._active = true;
    this.port.onmessage = (ev) => {
      if (ev.data === "stop") {
        // Flush trailing samples so the end of the message is not cut off
        if (this._offset > 0) {
          this.port.postMessage(this._buf.slice(0, this._offset));
          this._offset = 0;
        }
        this._active = false;
        this.port.postMessage("flushed");
      }
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0] && inputs[0][0];
    if (!input || !input.length) return true;

    let i = 0;
    while (i < input.length) {
      const space = this._buf.length - this._offset;
      const n = Math.min(space, input.length - i);
      this._buf.set(input.subarray(i, i + n), this._offset);
      this._offset += n;
      i += n;
      if (this._offset >= this._buf.length) {
        this.port.postMessage(this._buf.slice(0));
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture-processor", VoiceCaptureProcessor);
