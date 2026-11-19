"""Garante o conector do Whisper (e remove o FilmCraft quebrado) no Claude Desktop.
Rodar com o Claude Desktop FECHADO, senao ele regrava a configuracao por cima.
"""
import json
from pathlib import Path

CFG = Path(r"C:\Users\Maike\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\claude_desktop_config.json")
PYTHON = r"C:\Users\Maike\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\python.exe"
SERVIDOR = str(Path(__file__).with_name("mcp_server.py"))

cfg = json.loads(CFG.read_text(encoding="utf-8"))
servidores = cfg.setdefault("mcpServers", {})
servidores["whisper"] = {"command": PYTHON, "args": [SERVIDOR]}
servidores.pop("filmcraft", None)
CFG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
print("Conectores do Claude Desktop:", ", ".join(servidores))
