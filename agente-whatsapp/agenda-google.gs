// Cole no Google Apps Script e publique como "App da Web" (Executar como: Eu | Acesso: Qualquer pessoa)
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ini = new Date(d.inicio + ':00-03:00');
  var fim = new Date(ini.getTime() + (d.duracaoMin || 30) * 60000);
  var ev = CalendarApp.getDefaultCalendar().createEvent(d.titulo, ini, fim, { description: d.descricao });
  ev.addPopupReminder(30); ev.addPopupReminder(5);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, id: ev.getId() })).setMimeType(ContentService.MimeType.JSON);
}
