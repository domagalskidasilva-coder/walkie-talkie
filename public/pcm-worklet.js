// AudioWorklet de captura.
//
// O navegador chama process() em blocos de 128 amostras (curtos demais para a
// rede). Acumulamos ~40 ms e mandamos um bloco maior de uma vez. O tamanho é
// derivado da taxa real do contexto (`sampleRate`), então funciona em qualquer
// taxa sem virar latência alta.

const FRAME_MS = 40;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._count = 0;
    this._frame = Math.round((sampleRate * FRAME_MS) / 1000);
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Cópia do canal mono atual.
      this._chunks.push(new Float32Array(input[0]));
      this._count += input[0].length;

      if (this._count >= this._frame) {
        const out = new Float32Array(this._count);
        let offset = 0;
        for (const c of this._chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        this._chunks = [];
        this._count = 0;
        // Transfere o buffer (sem cópia) para a thread principal.
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true; // mantém o processador vivo
  }
}

registerProcessor("capture-processor", CaptureProcessor);
