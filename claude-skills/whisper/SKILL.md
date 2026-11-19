---
name: whisper
description: Transcreve áudio ou vídeo para texto (e legendas .srt) localmente com o Whisper (faster-whisper), de graça e offline. Use quando o usuário pedir para transcrever, passar para texto, legendar ou entender o que é dito em um arquivo de áudio/vídeo (mp3, wav, m4a, ogg, opus do WhatsApp, mp4, etc.), ou digitar /whisper.
---

# Whisper — transcrição local

Rode (Python 3.11, já com faster-whisper instalado):

```bash
python ~/.claude/skills/whisper/transcrever.py "<arquivo>" --idioma pt
```

Opções:
- `--modelo` tiny | base | small (padrão) | medium | large-v3. Maior = mais preciso e mais lento. Para português com qualidade, `medium` ou `large-v3` (cabem bem na GPU). Cada modelo é baixado uma vez (small ≈ 480 MB, medium ≈ 1,5 GB, large-v3 ≈ 3 GB).
- `--idioma pt` (ou `en`...). Sem ele, o Whisper detecta sozinho.
- `--srt` também gera a legenda `.srt`.

Saída: imprime o texto e salva `<arquivo>.txt` ao lado do original. Áudios longos: rode em segundo plano.

Usa a GPU (RTX 3060 Ti, via nvidia-cublas/cudnn do pip) e cai para a CPU sozinho se a GPU falhar. A primeira linha da saída diz qual foi usada.
