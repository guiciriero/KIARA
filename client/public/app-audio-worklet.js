/**
 * app-audio-worklet.js
 * AudioWorkletProcessor usado por AppAudioMixer (src/services/appAudioMixer.ts).
 * Servido como arquivo estático (mesma origem) para funcionar com CSP `script-src 'self'`.
 *
 * Cada instância mantém um ring buffer estéreo de UM aplicativo (PID):
 *   - pré-buffer de ~80 ms antes de começar a tocar;
 *   - descarta o excesso quando o atraso passa de ~200 ms (limita a latência);
 *   - preenche com silêncio em caso de underrun e re-arma o pré-buffer.
 *
 * Mensagem recebida: { pcm: Float32Array (L,R,L,R...), frames: number }
 */
class AppAudioSourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 'sampleRate' é uma global do AudioWorkletGlobalScope
    this.capacity     = Math.floor(sampleRate * 0.5);   // capacidade do ring buffer: 500 ms
    this.targetFrames = Math.floor(sampleRate * 0.08);  // pré-buffer / nível alvo: 80 ms
    this.maxFrames    = Math.floor(sampleRate * 0.2);   // acima disso descartamos o excesso: 200 ms
    this.left  = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.readPos  = 0;
    this.writePos = 0;
    this.count    = 0;      // quadros (por canal) disponíveis no buffer
    this.primed   = false;  // true após atingir o pré-buffer

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.pcm) this.write(data.pcm, data.frames);
    };
  }

  // Desintercala (L,R,L,R...) e grava no ring buffer
  write(pcm, frames) {
    let start = 0;
    if (frames > this.capacity) {          // bloco maior que o buffer: fica só com o final
      start = frames - this.capacity;
      frames = this.capacity;
    }
    if (this.count + frames > this.capacity) {   // sem espaço: descarta os mais antigos
      const drop = this.count + frames - this.capacity;
      this.readPos = (this.readPos + drop) % this.capacity;
      this.count -= drop;
    }
    for (let i = 0; i < frames; i++) {
      const idx = (this.writePos + i) % this.capacity;
      this.left[idx]  = pcm[(start + i) * 2];
      this.right[idx] = pcm[(start + i) * 2 + 1];
    }
    this.writePos = (this.writePos + frames) % this.capacity;
    this.count += frames;

    // Limita a latência: se acumulou demais, volta ao nível alvo descartando o mais antigo
    if (this.count > this.maxFrames) {
      const drop = this.count - this.targetFrames;
      this.readPos = (this.readPos + drop) % this.capacity;
      this.count -= drop;
    }
  }

  process(inputs, outputs) {
    const out  = outputs[0];
    const outL = out[0];
    const outR = out[1];
    const n    = outL.length;

    // Aguardando pré-buffer: as saídas já vêm zeradas (silêncio)
    if (!this.primed) {
      if (this.count >= this.targetFrames) this.primed = true;
      else return true;
    }

    const toRead = Math.min(n, this.count);
    for (let i = 0; i < toRead; i++) {
      const idx = (this.readPos + i) % this.capacity;
      outL[i] = this.left[idx];
      if (outR) outR[i] = this.right[idx];
    }
    this.readPos = (this.readPos + toRead) % this.capacity;
    this.count  -= toRead;

    // Underrun: o restante permanece em silêncio e re-armamos o pré-buffer
    if (toRead < n) this.primed = false;
    return true;
  }
}

registerProcessor('app-audio-source-processor', AppAudioSourceProcessor);
