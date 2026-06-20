import { describe, it, expect } from "vitest";
import { encodeFrame, decodeFrame } from "./net";

describe("codec de quadro de áudio", () => {
  it("roundtrip preserva id e PCM (inclui extremos)", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234, -9999]);
    const buf = encodeFrame("ab12", pcm);
    const out = decodeFrame(buf.buffer)!;
    expect(out).not.toBeNull();
    expect(out.id).toBe("ab12");
    expect(Array.from(out.pcm)).toEqual(Array.from(pcm));
  });

  it("funciona com ids de tamanhos diferentes", () => {
    for (const id of ["x", "abcd", "abcdef"]) {
      const pcm = new Int16Array([5, 6, 7]);
      const out = decodeFrame(encodeFrame(id, pcm).buffer)!;
      expect(out.id).toBe(id);
      expect(Array.from(out.pcm)).toEqual([5, 6, 7]);
    }
  });

  it("retorna null para buffer vazio", () => {
    expect(decodeFrame(new ArrayBuffer(0))).toBeNull();
  });

  it("retorna null quando o idLen é maior que o buffer", () => {
    const bad = new Uint8Array([5, 97]); // idLen=5, mas só há 1 byte de id
    expect(decodeFrame(bad.buffer)).toBeNull();
  });
});
