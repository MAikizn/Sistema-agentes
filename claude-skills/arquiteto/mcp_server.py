"""Conector MCP do Arquiteto para o Claude Desktop (Chat/Cowork).

Expoe a ferramenta `executar_no_gpt`, que manda um prompt ao GPT pelo
Codex CLI (`codex exec`) numa pasta do PC e devolve a resposta final.
O Claude do chat planeja e escreve o prompt; o GPT executa; o Claude confere.
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from mcp.server.mcpserver import MCPServer

MODOS = {"read-only", "workspace-write"}
DOCUMENTOS = Path(os.path.expanduser("~")) / "Documents"
# Pastas onde o GPT nunca pode alterar arquivos (tunel / credenciais da Cloudflare).
# O CRM (Documents\matrix-crm) pode ser alterado quando o Maike pedir; ele tem AGENTS.md,
# HISTORICO.md e git, e cada alteracao vira uma versao salva (commit) automaticamente.
PROTEGIDAS = [Path(os.path.expanduser("~")) / ".cloudflared"]

servidor = MCPServer("arquiteto")


def _codex() -> str | None:
    return shutil.which("codex.cmd") or shutil.which("codex")


def _protegida(pasta: Path) -> bool:
    for p in PROTEGIDAS:
        try:
            pasta.relative_to(p.resolve())
            return True
        except ValueError:
            continue
    return False


@servidor.tool(description=(
    "Arquiteto: envia um prompt ao GPT (Codex CLI) para executar uma tarefa numa pasta "
    "do computador do Maike e devolve a resposta final do GPT. Use quando o Maike chamar "
    "o Arquiteto. Escreva um prompt completo (objetivo, contexto, passos, limites, criterio "
    "de pronto). modo='read-only' para analises/planos/textos (padrao); "
    "modo='workspace-write' so quando o pedido for criar ou alterar arquivos na pasta "
    "(no CRM Matrix, so se o Maike pedir claramente para alterar o CRM). "
    "Se a pasta tiver AGENTS.md (o CRM tem), mande o GPT ler AGENTS.md e HISTORICO.md primeiro "
    "e acrescentar uma entrada no HISTORICO.md ao terminar. Em pastas com git, cada execucao "
    "workspace-write que mudar algo vira um commit automatico. Nunca altera a pasta do tunel. "
    "modelo: vazio usa o padrao do Codex; 'gpt-6-astra' quando o Maike pedir o GPT 6 Astra."
))
def executar_no_gpt(prompt: str, pasta: str, modo: str = "read-only", modelo: str = "") -> str:
    """prompt: instrucoes completas para o GPT.
    pasta: pasta de trabalho, caminho completo (ex.: C:\\Users\\Maike\\Documents\\agente-niobe).
    modo: 'read-only' ou 'workspace-write'."""
    modo = (modo or "read-only").strip()
    if modo not in MODOS:
        return f"Modo invalido: {modo}. Use 'read-only' ou 'workspace-write'."
    dir_ = Path(pasta.strip().strip('"'))
    if not dir_.is_dir():
        return f"Pasta nao encontrada: {dir_}"
    dir_ = dir_.resolve()
    if modo == "workspace-write" and _protegida(dir_):
        return f"Bloqueado: {dir_} e protegida (tunel / credenciais). Use read-only ou outra pasta."
    codex = _codex()
    if not codex:
        return "Codex CLI nao encontrado no PATH. Instale com: npm i -g @openai/codex"

    with tempfile.TemporaryDirectory(prefix="arquiteto-") as tmp:
        saida = Path(tmp) / "resposta.md"
        # No Windows o Codex so roda comandos com o sandbox "unelevated";
        # sem ele, todo comando volta "blocked by policy".
        cmd = [codex, "exec", "-s", modo, "-c", 'windows.sandbox="unelevated"',
               "-C", str(dir_), "--skip-git-repo-check", "-o", str(saida), "-"]
        if modelo.strip():
            cmd[2:2] = ["-m", modelo.strip()]
        try:
            r = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=1800)
        except subprocess.TimeoutExpired:
            return "O GPT passou de 30 minutos e a execucao foi interrompida."
        resposta = saida.read_text(encoding="utf-8", errors="replace").strip() if saida.exists() else ""
        if r.returncode != 0 and not resposta:
            erro = (r.stderr or r.stdout)[-2000:]
            if "login" in erro.lower() or "auth" in erro.lower():
                erro += "\n\nParece erro de login: rode `codex login` no terminal."
            return "Erro no Codex:\n" + erro
        log = (r.stderr or "") + "\n" + (r.stdout or "")
        modelo = re.search(r"^model:\s*(\S+)", log, re.M)
        prov = re.search(r"^provider:\s*(\S+)", log, re.M)
        tokens = re.search(r"tokens used\s*\n?\s*([\d.,]+)", log)
        uso = (f"modelo {modelo.group(1) if modelo else '?'} ({prov.group(1) if prov else '?'}) | "
               f"tokens {tokens.group(1) if tokens else '?'}")
        versao = _salvar_versao(dir_, prompt) if modo == "workspace-write" else ""
        return (f"[GPT | {uso} | modo {modo} | pasta {dir_}]{versao}\n\n" + (resposta or r.stdout[-4000:]))


def _salvar_versao(dir_: Path, prompt: str) -> str:
    """Se a pasta for um repositorio git e algo mudou, salva um commit local (nunca faz push)."""
    if not (dir_ / ".git").exists() or not shutil.which("git"):
        return ""

    def git(*a):
        return subprocess.run(["git", "-C", str(dir_), *a], capture_output=True, text=True,
                              encoding="utf-8", errors="replace")

    if not git("status", "--porcelain").stdout.strip():
        return "\n[versao: nada mudou]"
    resumo = " ".join(prompt.split())[:70]
    git("add", "-A")
    c = git("commit", "-m", f"Arquiteto: {resumo}")
    if c.returncode != 0:
        return "\n[versao: o commit falhou: " + (c.stderr or c.stdout).strip()[-200:] + "]"
    return "\n[versao salva no git: " + git("log", "-1", "--format=%h").stdout.strip() + "]"


if __name__ == "__main__":
    servidor.run("stdio")
