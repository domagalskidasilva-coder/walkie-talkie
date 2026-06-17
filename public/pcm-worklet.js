// AudioWorklet de captura.
//
// O navegador chama process() a cada 128 amostras (~2,7 ms a 48 kHz). Isso é
// pequeno demais para mandar pela rede. Então acumulamos até FRAME amostras
// (~40 ms) e mandamos um bloco maior para a thread principal de uma vez.

const FRAME = 2048; // amostras por bloco (~42 ms a 48 kHz)

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Cópia do canal mono atual.
      this._chunks.push(new Float32Array(input[0]));
      this._count += input[0].length;

      if (this._count >= FRAME) {
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
