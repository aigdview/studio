// public/audio-processor.js

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    // Buffer 100ms of audio data at 16kHz
    this.bufferSize = 1600; 
    this._bytes = new Int16Array(this.bufferSize);
    this._bytesWritten = 0;
  }

  // pcm-to-base64
  // Reference: https://github.com/xiangyuecn/Recorder/blob/master/src/engine/wav.js
  pcmToBase64(pcm) {
    let
      pcm_data = new Uint8Array(pcm.buffer)
      , pcm_len = pcm_data.length
      , pcm_idx = 0;

    let
      bytes = ""
      , base64 = ""
      , code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
      , b, L, R, c, d;

    while (pcm_idx < pcm_len) {
      b = pcm_data[pcm_idx];
      pcm_idx++;
      bytes += String.fromCharCode(b);

      if (bytes.length >= 3) {
        L = bytes.charCodeAt(0);
        R = bytes.charCodeAt(1);
        c = bytes.charCodeAt(2);
        bytes = "";

        d = L >> 2;
        base64 += code[d];

        d = (L & 3) << 4 | R >> 4;
        base64 += code[d];

        d = (R & 15) << 2 | c >> 6;
        base64 += code[d];

        d = c & 63;
        base64 += code[d];
      };
    };

    if (bytes.length > 0) {
      L = bytes.charCodeAt(0);
      R = bytes.length > 1 ? bytes.charCodeAt(1) : 0;
      c = 0;

      d = L >> 2;
      base64 += code[d];

      d = (L & 3) << 4 | R >> 4;
      base64 += code[d];

      if (bytes.length > 1) {
        d = (R & 15) << 2 | c >> 6;
        base64 += code[d];
      };
      base64 += bytes.length > 1 ? "=" : "==";
    };

    return base64;
  };

  process(inputs, outputs, parameters) {
    // Only process mono audio
    const input = inputs[0];
    const channelData = input[0];
    if (!channelData) {
      return true;
    }

    // Buffer audio data
    for (let i = 0; i < channelData.length; i++) {
        const val = Math.max(-1, Math.min(1, channelData[i]));
        this._bytes[this._bytesWritten] = val * 0x7FFF;
        this._bytesWritten++;

        if (this._bytesWritten >= this.bufferSize) {
            const base64 = this.pcmToBase64(this._bytes);
            this.port.postMessage({ audioData: base64 });
            this._bytesWritten = 0;
        }
    }

    return true;
  }
}

try {
  registerProcessor('audio-processor', AudioProcessor);
} catch (e) {
  console.error("Failed to register audio-processor", e);
}
