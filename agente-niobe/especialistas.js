// Os 30 especialistas da Niobe. "texto" = trabalho feito pelo FreeLLMAPI; "video" = FFmpeg/FilmCraft no PC.
const E = [
  ['triador', 'Triador', 'Pré-produção', 'video'], ['transcritor', 'Transcritor', 'Pré-produção', 'texto'],
  ['analista', 'Analista de conteúdo', 'Pré-produção', 'texto'], ['roteirista', 'Roteirista de cortes', 'Pré-produção', 'texto'],
  ['ganchos', 'Especialista em ganchos', 'Pré-produção', 'texto'], ['copy', 'Copywriter de anúncio', 'Pré-produção', 'texto'],
  ['montador', 'Montador', 'Montagem', 'video'], ['silencio', 'Cortador de silêncio', 'Montagem', 'video'],
  ['erros', 'Removedor de erros', 'Montagem', 'video'], ['ritmista', 'Ritmista', 'Montagem', 'video'],
  ['broll', 'Editor de B-roll', 'Montagem', 'video'], ['reenquadrador', 'Reenquadrador', 'Montagem', 'video'],
  ['velocidade', 'Editor de velocidade', 'Montagem', 'video'], ['motion', 'Motion designer', 'Motion', 'video'],
  ['zoom', 'Zoom dinâmico', 'Motion', 'video'], ['tipografo', 'Tipógrafo', 'Motion', 'video'],
  ['legendista', 'Legendista', 'Motion', 'video'], ['transicoes', 'Designer de transições', 'Motion', 'video'],
  ['efeitos', 'Especialista em efeitos', 'Motion', 'video'], ['marca', 'Marca e identidade', 'Motion', 'video'],
  ['colorTec', 'Colorista técnico', 'Cor', 'video'], ['colorCri', 'Colorista criativo', 'Cor', 'video'],
  ['consistencia', 'Consistência de cor', 'Cor', 'video'], ['voz', 'Engenheiro de voz', 'Áudio', 'video'],
  ['trilha', 'Trilha sonora', 'Áudio', 'video'], ['sfx', 'Sound designer', 'Áudio', 'video'],
  ['mix', 'Mixador final', 'Áudio', 'video'], ['revisor', 'Revisor de qualidade', 'Entrega', 'video'],
  ['exportador', 'Exportador', 'Entrega', 'video'], ['versionador', 'Versionador', 'Entrega', 'video'],
].map(([id, nome, area, tipo]) => ({ id, nome, area, tipo }));

// Ordem de trabalho por tipo de edição
const FLUXOS = {
  reels: ['triador', 'transcritor', 'analista', 'roteirista', 'ganchos', 'montador', 'silencio', 'erros', 'reenquadrador', 'zoom', 'legendista', 'tipografo', 'colorTec', 'voz', 'mix', 'revisor', 'exportador'],
  anuncio: ['triador', 'transcritor', 'copy', 'ganchos', 'roteirista', 'montador', 'ritmista', 'silencio', 'reenquadrador', 'zoom', 'tipografo', 'legendista', 'marca', 'colorCri', 'voz', 'mix', 'revisor', 'exportador', 'versionador'],
  limpeza: ['triador', 'montador', 'silencio', 'erros', 'colorTec', 'voz', 'mix', 'revisor', 'exportador'],
  profissional: ['triador', 'transcritor', 'analista', 'roteirista', 'ganchos', 'montador', 'silencio', 'erros', 'reenquadrador', 'motion', 'zoom', 'tipografo', 'legendista', 'transicoes', 'efeitos', 'colorTec', 'colorCri', 'consistencia', 'voz', 'sfx', 'mix', 'revisor', 'exportador'],
};
const porId = Object.fromEntries(E.map(e => [e.id, e]));
module.exports = { ESPECIALISTAS: E, FLUXOS, porId };
