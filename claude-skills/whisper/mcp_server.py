"""Conector MCP do Whisper para o Claude Desktop (Chat/Cowork).

Expoe a ferramenta `transcrever`, que roda o transcrever.py (faster-whisper)
num processo separado e devolve o texto.
"""
import subprocess
import sys
from pathlib import Path

from mcp.server.mcpserver import MCPServer

SCRIPT = Path(__file__).with_name("transcrever.py")
servidor = MCPServer("whisper")


@servidor.tool(description=(
    "Transcreve um arquivo de audio ou video do computador do usuario para texto "
    "com o Whisper (local, GPU). Aceita mp3, wav, m4a, ogg/opus do WhatsApp, mp4, mov etc. "
    "Salva <arquivo>.txt (e .srt se legenda=True) ao lado do original e devolve o texto."
))
def transcrever(caminho: str, idioma: str = "pt", modelo: str = "small", legenda: bool = False) -> str:
    """caminho: caminho completo do arquivo (ex.: C:\\Users\\Maike\\Documents\\video.mp4).
    idioma: pt, en... ou vazio para detectar. modelo: tiny, base, small, medium, large-v3.
    legenda: True para gerar tambem a legenda .srt com tempos."""
    arq = Path(caminho.strip().strip('"'))
    if not arq.exists():
        return f"Arquivo nao encontrado: {arq}"
    cmd = [sys.executable, str(SCRIPT), str(arq), "--modelo", modelo]
    if idioma:
        cmd += ["--idioma", idioma]
    if legenda:
        cmd.append("--srt")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=3600, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        return "Erro na transcricao:\n" + (r.stderr or r.stdout)[-2000:]
    extra = f"\nLegenda salva em: {arq.with_suffix('.srt')}" if legenda else ""
    return r.stdout.strip() + f"\n\nTexto salvo em: {arq.with_suffix('.txt')}{extra}"


if __name__ == "__main__":
    servidor.run("stdio")
