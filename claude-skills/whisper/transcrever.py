"""Transcreve audio/video com faster-whisper.

Uso: python transcrever.py <arquivo> [--modelo small] [--idioma pt] [--srt]
Imprime o texto e salva <arquivo>.txt (e .srt com --srt) ao lado do original.
"""
import argparse
import os
import sys
from pathlib import Path

# No Windows, registra as DLLs CUDA instaladas via pip (nvidia-cublas/cudnn).
try:
    import nvidia
    for raiz in nvidia.__path__:
        for bin_dir in Path(raiz).glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]
except ImportError:
    pass

from faster_whisper import WhisperModel


def carregar_modelo(nome):
    try:
        return WhisperModel(nome, device="cuda", compute_type="float16"), "GPU"
    except Exception:
        return WhisperModel(nome, device="cpu", compute_type="int8"), "CPU"


def tempo_srt(s):
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("arquivo")
    p.add_argument("--modelo", default="small", help="tiny, base, small, medium, large-v3")
    p.add_argument("--idioma", default=None, help="ex.: pt, en (vazio = detecta)")
    p.add_argument("--srt", action="store_true", help="gera legenda .srt")
    a = p.parse_args()

    arq = Path(a.arquivo)
    if not arq.exists():
        sys.exit(f"Arquivo nao encontrado: {arq}")

    modelo, onde = carregar_modelo(a.modelo)
    try:
        segs, info = modelo.transcribe(str(arq), language=a.idioma, vad_filter=True)
        segs = list(segs)
    except RuntimeError:
        if onde != "GPU":
            raise
        modelo, onde = WhisperModel(a.modelo, device="cpu", compute_type="int8"), "CPU"
        segs, info = modelo.transcribe(str(arq), language=a.idioma, vad_filter=True)
        segs = list(segs)

    texto = " ".join(s.text.strip() for s in segs)
    arq.with_suffix(".txt").write_text(texto, encoding="utf-8")
    if a.srt:
        linhas = [f"{i}\n{tempo_srt(s.start)} --> {tempo_srt(s.end)}\n{s.text.strip()}\n"
                  for i, s in enumerate(segs, 1)]
        arq.with_suffix(".srt").write_text("\n".join(linhas), encoding="utf-8")

    sys.stdout.reconfigure(encoding="utf-8")
    print(f"[{onde} | modelo {a.modelo} | idioma {info.language} | {info.duration:.0f}s]")
    print(texto)


if __name__ == "__main__":
    main()
