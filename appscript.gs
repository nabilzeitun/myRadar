// ══════════════════════════════════════════════════════════════
// myRadar — Apps Script v2.1
// Índices:  A=NOMBRE B=MERCADO C=TICKER D=VALOR E=UMBRAL_LOW
//           F=UMBRAL_HIGH G=TS_PRECIO H=TS_UMBRAL I=PERC_LOW J=PERC_HIGH
// FX:       A=KEY B=VALOR C=UMBRAL_LOW D=UMBRAL_HIGH
//           E=TS_PRECIO F=TS_UMBRAL G=PERC_LOW H=PERC_HIGH
// ══════════════════════════════════════════════════════════════

var INDEX_CONFIG = [
  { t: 'VIX',    sources: [['yahoo','^VIX'],   ['cboe','_VIX']]                               },
  { t: 'VVIX',   sources: [['yahoo','^VVIX'],  ['cboe','_VVIX']]                              },
  { t: 'VXN',    sources: [['yahoo','^VXN'],   ['cboe','_VXN']]                               },
  { t: 'VXD',    sources: [['yahoo','^VXD'],   ['cboe','_VXD']]                               },
  { t: 'RVX',    sources: [['cboe','_RVX'],    ['yahoo','^RVX']]                              },
  { t: 'VHSI',   sources: [['yahoo','^HSIL'],  ['yahoo','^VHSI']]                             },
  { t: 'VSTOXX', sources: [['stoxx','v1x'],    ['yahoo','^V2TX'], ['yahoo','V2TX.DE']]         },
  { t: 'VFTSE',  sources: [['yahoo','^VFTSE'], ['yahoo','VFTSE.L'], ['cboe','_VFTSE']]         },
];

var FX_CONFIG = [
  { k: 'EURUSD', ticker: 'EURUSD=X' },
  { k: 'EURGBP', ticker: 'EURGBP=X' },
  { k: 'EURHKD', ticker: 'EURHKD=X' },
  { k: 'EURAUD', ticker: 'EURAUD=X' },
  { k: 'EURCHF', ticker: 'EURCHF=X' },
];

var MANUAL_THRESH = ['VFTSE'];

// ── Helpers ──────────────────────────────────────────────────
function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }
function tsNow() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yy HH:mm');
}

// ── Fetch precio actual ───────────────────────────────────────
function fetchCBOE(symbol) {
  try {
    var resp = UrlFetchApp.fetch(
      'https://cdn.cboe.com/api/global/delayed_quotes/quotes/' + symbol + '.json',
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    var p = JSON.parse(resp.getContentText()).data.last;
    return (p != null && p > 0) ? p : null;
  } catch(e) { return null; }
}

function fetchYahooPrice(ticker) {
  var hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (var h = 0; h < hosts.length; h++) {
    try {
      var url = 'https://' + hosts[h] + '/v8/finance/chart/' +
                encodeURIComponent(ticker) + '?interval=1d&range=5d';
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) continue;
      var closes = JSON.parse(resp.getContentText()).chart.result[0].indicators.quote[0].close;
      for (var i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null && closes[i] > 0) return closes[i];
      }
    } catch(e) {}
  }
  return null;
}

function fetchCurrentSTOXX(symbol) {
  try {
    var url = 'https://stoxx.com/documents/stoxxnet/Documents/Indices/Current/HistoricalData/h_' + symbol + '.txt';
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'Range': 'bytes=-500' } });
    if (resp.getResponseCode() !== 206 && resp.getResponseCode() !== 200) return null;
    var lines = resp.getContentText().trim().split('\n');
    for (var i = lines.length - 1; i >= 0; i--) {
      var parts = lines[i].trim().split(';');
      if (parts.length >= 2) {
        var v = parseFloat(parts[1].replace(',', '.'));
        if (!isNaN(v) && v > 0) return v;
      }
    }
    return null;
  } catch(e) { return null; }
}

function fetchPrice(sources) {
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i][0], sym = sources[i][1], price = null;
    if (src === 'cboe')  price = fetchCBOE(sym);
    if (src === 'yahoo') price = fetchYahooPrice(sym);
    if (src === 'stoxx') price = fetchCurrentSTOXX(sym);
    if (price != null) { Logger.log('OK ' + sym + ' via ' + src + ': ' + price); return price; }
    Logger.log('FAILED ' + sym + ' via ' + src);
  }
  return null;
}

// ── Fetch histórico ───────────────────────────────────────────
function fetchHistoricalYahoo(ticker) {
  var ranges = ['10y', '5y', '3y'];
  var hosts  = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (var r = 0; r < ranges.length; r++) {
    for (var h = 0; h < hosts.length; h++) {
      try {
        var url = 'https://' + hosts[h] + '/v8/finance/chart/' +
                  encodeURIComponent(ticker) + '?interval=1mo&range=' + ranges[r];
        var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (resp.getResponseCode() !== 200) continue;
        var closes = JSON.parse(resp.getContentText()).chart.result[0].indicators.quote[0].close;
        var valid  = closes.filter(function(v){ return v != null && v > 0; });
        if (valid.length > 12) return valid;
      } catch(e) {}
    }
  }
  return null;
}

function fetchHistoricalSTOXX(symbol) {
  try {
    var url = 'https://stoxx.com/documents/stoxxnet/Documents/Indices/Current/HistoricalData/h_' + symbol + '.txt';
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var values = [];
    resp.getContentText().trim().split('\n').forEach(function(line) {
      var parts = line.trim().split(';');
      if (parts.length >= 2) {
        var v = parseFloat(parts[1].replace(',', '.'));
        if (!isNaN(v) && v > 0) values.push(v);
      }
    });
    return values.length > 12 ? values : null;
  } catch(e) { return null; }
}

// ── updateIndices ─────────────────────────────────────────────
function updateIndices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('indices');
  var data  = sheet.getDataRange().getValues();
  var ts    = tsNow();

  var rowMap = {};
  for (var i = 1; i < data.length; i++) {
    var t = (data[i][2] || '').toString().trim().toUpperCase();
    if (t) rowMap[t] = i + 1;
  }

  INDEX_CONFIG.forEach(function(cfg) {
    var price = fetchPrice(cfg.sources);
    if (price == null) { Logger.log('Sin precio: ' + cfg.t); return; }
    var row = rowMap[cfg.t];
    if (!row) { Logger.log('Fila no encontrada: ' + cfg.t); return; }
    sheet.getRange(row, 4).setNumberFormat('0.00').setValue(round2(price));
    sheet.getRange(row, 7).setValue(ts);
  });
}

// ── updateFX ──────────────────────────────────────────────────
function updateFX() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('fx');
  var data  = sheet.getDataRange().getValues();
  var ts    = tsNow();

  var rowMap = {};
  for (var i = 1; i < data.length; i++) {
    var k = (data[i][0] || '').toString().trim().toUpperCase();
    if (k) rowMap[k] = i + 1;
  }

  FX_CONFIG.forEach(function(cfg) {
    var price = fetchYahooPrice(cfg.ticker);
    if (price == null) { Logger.log('Sin precio FX: ' + cfg.k); return; }
    var row = rowMap[cfg.k];
    if (!row) { Logger.log('Fila FX no encontrada: ' + cfg.k); return; }
    sheet.getRange(row, 2).setNumberFormat('0.0000').setValue(round4(price));
    sheet.getRange(row, 5).setValue(ts);
  });
}

// ── updateIndicesThresholds ───────────────────────────────────
function updateIndicesThresholds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('indices');
  var data  = sheet.getDataRange().getValues();
  var ts    = tsNow();

  for (var i = 1; i < data.length; i++) {
    var ticker   = (data[i][2] || '').toString().trim().toUpperCase();
    var percLow  = parseFloat(data[i][8]) || 80;
    var percHigh = parseFloat(data[i][9]) || 95;
    if (!ticker) continue;
    if (MANUAL_THRESH.indexOf(ticker) !== -1) { Logger.log('Umbral manual: ' + ticker); continue; }

    var cfg = null;
    INDEX_CONFIG.forEach(function(c){ if (c.t === ticker) cfg = c; });
    if (!cfg) continue;

    var hist = null;
    for (var s = 0; s < cfg.sources.length; s++) {
      var src = cfg.sources[s][0], sym = cfg.sources[s][1];
      if (src === 'yahoo') hist = fetchHistoricalYahoo(sym);
      if (src === 'stoxx') hist = fetchHistoricalSTOXX(sym);
      if (hist && hist.length > 12) break;
    }
    if (!hist || hist.length < 12) { Logger.log('Sin histórico: ' + ticker); continue; }

    var sorted = hist.slice().sort(function(a, b){ return a - b; });
    var pLow   = sorted[Math.floor(sorted.length * percLow  / 100)];
    var pHigh  = sorted[Math.floor(sorted.length * percHigh / 100)];

    sheet.getRange(i + 1, 5).setNumberFormat('0.00').setValue(round2(pLow));
    sheet.getRange(i + 1, 6).setNumberFormat('0.00').setValue(round2(pHigh));
    sheet.getRange(i + 1, 8).setValue(ts);
    Logger.log(ticker + ' P' + percLow + '=' + round2(pLow) + ' P' + percHigh + '=' + round2(pHigh));
  }
}

// ── updateFXThresholds ────────────────────────────────────────
function updateFXThresholds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('fx');
  var data  = sheet.getDataRange().getValues();
  var ts    = tsNow();

  for (var i = 1; i < data.length; i++) {
    var key      = (data[i][0] || '').toString().trim().toUpperCase();
    var percLow  = parseFloat(data[i][6]) || 15;
    var percHigh = parseFloat(data[i][7]) || 85;
    if (!key) continue;

    var cfg = null;
    FX_CONFIG.forEach(function(c){ if (c.k === key) cfg = c; });
    if (!cfg) continue;

    var hist = fetchHistoricalYahoo(cfg.ticker);
    if (!hist || hist.length < 12) { Logger.log('Sin histórico FX: ' + key); continue; }

    var sorted = hist.slice().sort(function(a, b){ return a - b; });
    var pLow   = sorted[Math.floor(sorted.length * percLow  / 100)];
    var pHigh  = sorted[Math.floor(sorted.length * percHigh / 100)];

    sheet.getRange(i + 1, 3).setNumberFormat('0.0000').setValue(round4(pLow));
    sheet.getRange(i + 1, 4).setNumberFormat('0.0000').setValue(round4(pHigh));
    sheet.getRange(i + 1, 6).setValue(ts);
    Logger.log(key + ' P' + percLow + '=' + round4(pLow) + ' P' + percHigh + '=' + round4(pHigh));
  }
}

// ── setupTrigger ──────────────────────────────────────────────
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('updateIndices').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('updateFX').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('updateIndicesThresholds').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
  ScriptApp.newTrigger('updateFXThresholds').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var idxSheet = ss.getSheetByName('indices');
  var idxData  = idxSheet.getDataRange().getValues();
  for (var i = 1; i < idxData.length; i++) {
    if (!idxData[i][8]) idxSheet.getRange(i+1,  9).setValue(80);
    if (!idxData[i][9]) idxSheet.getRange(i+1, 10).setValue(95);
  }

  var fxSheet = ss.getSheetByName('fx');
  var fxData  = fxSheet.getDataRange().getValues();
  for (var i = 1; i < fxData.length; i++) {
    if (!fxData[i][6]) fxSheet.getRange(i+1, 7).setValue(15);
    if (!fxData[i][7]) fxSheet.getRange(i+1, 8).setValue(85);
  }

  updateIndicesThresholds();
  updateFXThresholds();

  Logger.log('Triggers configurados correctamente.');
}
