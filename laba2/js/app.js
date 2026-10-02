(function () {
  'use strict';

  var MAX_FILES = 100000;
  var READ_LIMITS = [131072, 524288, 2097152];
  var PCX_TAIL_BYTES = 1024;
  var PARALLELISM = 32;
  var PAGE_SIZE = 500;
  var PROGRESS_STEP_MS = 100;
  var SEARCH_DEBOUNCE_MS = 200;
  var COMPRESSION_MAX = 40;

  var BADGE_CLASSES = {
    JPEG: 'badge-jpg',
    GIF: 'badge-gif',
    TIFF: 'badge-tif',
    BMP: 'badge-bmp',
    PNG: 'badge-png',
    PCX: 'badge-pcx'
  };

  var NUMERIC_SORT_KEYS = { width: true, height: true, dpi: true, bitDepth: true, sizeBytes: true };

  var rows = [];
  var view = { filter: 'all', query: '', sortKey: null, sortDir: 'asc', page: 1 };
  var runToken = 0;
  var searchTimer = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  var dom = {
    folderInput: byId('file-folder'),
    filesInput: byId('file-files'),
    btnCsv: byId('btn-csv'),
    btnHelp: byId('btn-help'),
    btnClear: byId('btn-clear'),
    dropzone: byId('dropzone'),
    progressWrap: byId('progress-wrap'),
    progressBar: byId('progress-bar'),
    progressText: byId('progress-text'),
    summary: byId('summary'),
    statTotal: byId('stat-total'),
    statOk: byId('stat-ok'),
    statError: byId('stat-error'),
    statSkipped: byId('stat-skipped'),
    statTime: byId('stat-time'),
    statFormats: byId('stat-formats'),
    filterSearch: byId('filter-search'),
    formatChips: byId('format-chips'),
    tableHead: document.querySelector('#result-table thead'),
    tableBody: byId('table-body'),
    pagePrev: byId('page-prev'),
    pageNext: byId('page-next'),
    pageInfo: byId('page-info'),
    drawer: byId('drawer'),
    drawerOverlay: byId('drawer-overlay'),
    drawerTitle: byId('drawer-title'),
    drawerClose: byId('drawer-close'),
    drawerBody: byId('drawer-body'),
    helpModal: byId('help-modal'),
    helpClose: byId('help-close')
  };

  var sortHeaders = Array.prototype.slice.call(
    document.querySelectorAll('#result-table thead th[data-sort]')
  );

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  function show(node) {
    node.hidden = false;
    node.classList.remove('hidden');
  }

  function hide(node) {
    node.hidden = true;
    node.classList.add('hidden');
  }

  function isVisible(node) {
    return !node.hidden && !node.classList.contains('hidden');
  }

  function formatSeconds(ms) {
    return (ms / 1000).toFixed(1).replace('.', ',');
  }

  function humanSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '—';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1).replace('.', ',') + ' КБ';
    return (bytes / 1048576).toFixed(2).replace('.', ',') + ' МБ';
  }

  function messageOf(error) {
    if (typeof error === 'string' && error) return error;
    if (error && error.message) return error.message;
    return 'Неизвестная ошибка';
  }

  function displayName(row) {
    return row.dir ? row.dir + '/' + row.name : row.name;
  }

  function isMatrix(value) {
    return Array.isArray(value) && Array.isArray(value[0]);
  }

  function relDirOf(file) {
    var path = file.webkitRelativePath || '';
    var slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  }

  function itemsFromFileList(fileList) {
    var items = [];
    for (var i = 0; i < fileList.length; i++) {
      items.push({ file: fileList[i], dir: relDirOf(fileList[i]) });
    }
    return items;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function entriesFromDrop(dataTransfer) {
    if (!dataTransfer || !dataTransfer.items) return null;
    var entries = [];
    for (var i = 0; i < dataTransfer.items.length; i++) {
      var item = dataTransfer.items[i];
      if (item.kind !== 'file') continue;
      if (typeof item.webkitGetAsEntry !== 'function') return null;
      var entry = item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    return entries.length ? entries : null;
  }

  function entryFile(entry) {
    return new Promise(function (resolve) {
      entry.file(function (file) { resolve(file); }, function () { resolve(null); });
    });
  }

  function readEntryBatch(reader) {
    return new Promise(function (resolve) {
      reader.readEntries(function (batch) { resolve(batch); }, function () { resolve([]); });
    });
  }

  async function collectEntryFiles(entry, parentPath, out) {
    if (entry.isFile) {
      var file = await entryFile(entry);
      if (file) out.push({ file: file, dir: parentPath });
      return;
    }
    if (!entry.isDirectory) return;

    var childBase = parentPath ? parentPath + '/' + entry.name : entry.name;
    var reader = entry.createReader();

    for (;;) {
      var batch = await readEntryBatch(reader);
      if (!batch.length) break;
      for (var i = 0; i < batch.length; i++) {
        await collectEntryFiles(batch[i], childBase, out);
      }
    }
  }

  function onDrop(event) {
    stopEvent(event);
    dom.dropzone.classList.remove('dragover');

    var entries = entriesFromDrop(event.dataTransfer);
    if (entries) {
      var items = [];
      (async function () {
        for (var i = 0; i < entries.length; i++) {
          await collectEntryFiles(entries[i], '', items);
        }
        beginRun(items);
      })();
      return;
    }
    if (event.dataTransfer && event.dataTransfer.files) {
      beginRun(itemsFromFileList(event.dataTransfer.files));
    }
  }

  function onInputChange() {
    beginRun(itemsFromFileList(this.files || []));
    this.value = '';
  }

  function buildRow(item, index) {
    var file = item.file;
    var name = file.name;
    var dot = name.lastIndexOf('.');
    var ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
    return {
      index: index,
      name: name,
      dir: item.dir || '',
      ext: ext,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      status: ImgInfo.extensions[ext] ? 'pending' : 'skipped',
      result: null,
      errorMessage: '',
      file: file
    };
  }

  function readBlob(blob) {
    if (typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer();
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Не удалось прочитать файл')); };
      reader.readAsArrayBuffer(blob);
    });
  }

  async function readHead(file, limit) {
    var buffer = await readBlob(file.slice(0, limit));
    return new Uint8Array(buffer);
  }

  async function readTail(file, tailLength) {
    var buffer = await readBlob(file.slice(Math.max(0, file.size - tailLength)));
    return new Uint8Array(buffer);
  }

  function tryParse(bytes, ext, fileSize, tailBytes) {
    try {
      return { value: ImgInfo.parse(bytes, ext, fileSize, tailBytes) };
    } catch (error) {
      return { error: messageOf(error) };
    }
  }

  async function parseRow(row) {
    var file = row.file;
    var size = row.sizeBytes;
    var head = null;
    var parsed = null;

    for (var stage = 0; stage < READ_LIMITS.length; stage++) {
      head = await readHead(file, Math.min(size, READ_LIMITS[stage]));
      parsed = tryParse(head, row.ext, size, null);
      if (parsed.error) {
        row.status = 'error';
        row.errorMessage = parsed.error;
        return;
      }
      if (!parsed.value.needMoreBytes) break;
      if (stage === READ_LIMITS.length - 1 || head.length >= size) {
        row.status = 'error';
        row.errorMessage = 'заголовок не прочитан';
        return;
      }
    }

    if (parsed.value.format === 'PCX') {
      var tail = await readTail(file, PCX_TAIL_BYTES);
      parsed = tryParse(head, row.ext, size, tail);
      if (parsed.error) {
        row.status = 'error';
        row.errorMessage = parsed.error;
        return;
      }
    }

    row.result = parsed.value;
    row.status = 'ok';
  }

  function beginRun(items) {
    if (!items.length) return;
    if (items.length > MAX_FILES) items = items.slice(0, MAX_FILES);

    var token = ++runToken;
    rows = items.map(buildRow);
    view = { filter: 'all', query: '', sortKey: null, sortDir: 'asc', page: 1 };

    dom.filterSearch.value = '';
    clearTimeout(searchTimer);
    closeDrawer();
    hide(dom.summary);

    show(dom.progressWrap);
    dom.progressBar.style.width = '0%';
    dom.progressText.textContent =
      'Обработано 0 из ' + rows.length + ' · ошибок 0 · 0,0 с';

    dom.btnCsv.disabled = true;
    dom.btnClear.disabled = true;
    dom.tableBody.innerHTML = '';
    dom.formatChips.innerHTML = '';
    dom.pageInfo.textContent = '';
    dom.pagePrev.disabled = true;
    dom.pageNext.disabled = true;
    updateSortHeaders();

    run(rows, token);
  }

  async function run(batch, token) {
    var started = performance.now();
    var total = batch.length;
    var done = 0;
    var errors = 0;
    var nextIndex = 0;
    var lastPaint = 0;

    function paint(force) {
      var now = performance.now();
      if (!force && now - lastPaint < PROGRESS_STEP_MS) return;
      lastPaint = now;
      dom.progressBar.style.width = (total ? (done / total) * 100 : 0).toFixed(2) + '%';
      dom.progressText.textContent =
        'Обработано ' + done + ' из ' + total + ' · ошибок ' + errors + ' · ' +
        formatSeconds(now - started) + ' с';
    }

    async function worker() {
      for (;;) {
        var index = nextIndex;
        nextIndex++;
        if (index >= total) return;

        var row = batch[index];
        if (row.status !== 'skipped') {
          await parseRow(row);
          row.file = null;
        }
        if (row.status === 'error') errors++;
        done++;
        if (token === runToken) paint(false);
      }
    }

    var workers = [];
    var count = Math.min(PARALLELISM, total);
    for (var i = 0; i < count; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (token !== runToken) return;

    paint(true);
    hide(dom.progressWrap);
    finishRun(batch, performance.now() - started);
  }

  function finishRun(batch, elapsedMs) {
    var okCount = 0;
    var errorCount = 0;
    var skippedCount = 0;
    var formatCounts = {};

    batch.forEach(function (row) {
      if (row.status === 'ok') {
        okCount++;
        formatCounts[row.result.format] = (formatCounts[row.result.format] || 0) + 1;
      } else if (row.status === 'error') {
        errorCount++;
      } else {
        skippedCount++;
      }
    });

    dom.statTotal.textContent = 'Файлов: ' + batch.length;
    dom.statOk.textContent = 'Успешно: ' + okCount;
    dom.statError.textContent = 'Ошибки: ' + errorCount;
    dom.statSkipped.textContent = 'Пропущено: ' + skippedCount;
    dom.statTime.textContent = 'Время: ' + formatSeconds(elapsedMs) + ' с';

    var formats = Object.keys(formatCounts).sort();
    dom.statFormats.textContent = formats.length
      ? formats.map(function (format) { return format + ': ' + formatCounts[format]; }).join(' · ')
      : '—';

    show(dom.summary);
    dom.btnCsv.disabled = false;
    dom.btnClear.disabled = false;
    renderChips();
    renderTable();
  }

  function chipHtml(value, label, active) {
    return '<button type="button" class="chip' + (active ? ' active' : '') +
      '" data-filter="' + esc(value) + '">' + esc(label) + '</button>';
  }

  function renderChips() {
    var formatCounts = {};

    rows.forEach(function (row) {
      if (row.status === 'ok') {
        formatCounts[row.result.format] = (formatCounts[row.result.format] || 0) + 1;
      }
    });

    var html = chipHtml('all', 'Все', view.filter === 'all');
    Object.keys(formatCounts).sort().forEach(function (format) {
      html += chipHtml(format, format, view.filter === format);
    });
    html += chipHtml('error', 'Ошибки', view.filter === 'error');
    html += chipHtml('skipped', 'Пропущенные', view.filter === 'skipped');

    dom.formatChips.innerHTML = html;
  }

  function matchesFilter(row) {
    if (row.status === 'pending') return false;
    if (view.filter === 'error') return row.status === 'error';
    if (view.filter === 'skipped') return row.status === 'skipped';
    if (view.filter !== 'all') return row.status === 'ok' && row.result.format === view.filter;
    return true;
  }

  function sortValue(row, key) {
    var result = row.result;
    switch (key) {
      case 'name': return displayName(row);
      case 'format':
        if (row.status === 'ok') return result.format;
        return row.status === 'error' ? 'Ошибки' : 'Пропущенные';
      case 'width': return row.status === 'ok' ? result.width : null;
      case 'height': return row.status === 'ok' ? result.height : null;
      case 'dpi': return row.status === 'ok' ? result.dpiX : null;
      case 'bitDepth': return row.status === 'ok' ? result.bitDepth : null;
      case 'sizeBytes': return row.sizeBytes;
      default: return null;
    }
  }

  function compareRows(a, b) {
    var key = view.sortKey;
    var va = sortValue(a, key);
    var vb = sortValue(b, key);
    var result;

    if (NUMERIC_SORT_KEYS[key]) {
      var aEmpty = va == null;
      var bEmpty = vb == null;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      result = va - vb;
    } else {
      result = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'ru');
    }

    return view.sortDir === 'asc' ? result : -result;
  }

  function currentRows() {
    var query = view.query;
    var list = rows.filter(function (row) {
      if (!matchesFilter(row)) return false;
      return !query || row.name.toLowerCase().indexOf(query) !== -1;
    });
    if (view.sortKey) list.sort(compareRows);
    return list;
  }

  function updateSortHeaders() {
    sortHeaders.forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-sort') === view.sortKey) {
        th.classList.add(view.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function dpiText(result) {
    if (result.dpiX == null && result.dpiY == null) return '—';
    return (result.dpiX != null ? result.dpiX : '—') + ' × ' +
      (result.dpiY != null ? result.dpiY : '—');
  }

  function compressionTd(text) {
    if (text == null || text === '') return '<td>—</td>';
    var full = String(text);
    if (full.length <= COMPRESSION_MAX) return '<td>' + esc(full) + '</td>';
    return '<td title="' + esc(full) + '">' + esc(full.slice(0, COMPRESSION_MAX - 1)) + '…</td>';
  }

  function rowHtml(row, number) {
    var result = row.result;
    var rowClass = row.status === 'error' ? 'row-error' : (row.status === 'skipped' ? 'row-skipped' : '');

    var html = '<tr' + (rowClass ? ' class="' + rowClass + '"' : '') +
      ' data-idx="' + row.index + '">';
    html += '<td>' + number + '</td>';
    html += '<td><span class="cell-name">' + esc(row.name) + '</span>';
    if (row.dir) {
      html += '<span class="cell-dir" style="display:block;max-width:100%;overflow:hidden;' +
        'text-overflow:ellipsis;color:var(--muted);font-size:11px;font-weight:400">' +
        esc(row.dir) + '</span>';
    }
    html += '</td>';

    if (row.status === 'ok') {
      html += '<td><span class="badge ' + (BADGE_CLASSES[result.format] || '') + '">' +
        esc(result.format) + '</span></td>';
      html += '<td>' + (result.width != null && result.height != null
        ? result.width + ' × ' + result.height : '—') + '</td>';
      html += '<td>' + dpiText(result) + '</td>';
      html += '<td>' + (result.bitDepthText != null ? esc(result.bitDepthText) : '—') + '</td>';
      html += compressionTd(result.compression);
      html += '<td>' + (result.extras && result.extras.length ? '+' + result.extras.length : '—') + '</td>';
    } else if (row.status === 'error') {
      html += '<td>—</td><td>—</td><td>—</td><td>—</td>';
      html += '<td title="' + esc(row.errorMessage) + '">ошибка</td>';
      html += '<td>—</td>';
    } else {
      html += '<td>—</td><td>—</td><td>—</td><td>—</td>';
      html += '<td>пропущен (.' + esc(row.ext) + ')</td>';
      html += '<td>—</td>';
    }

    html += '<td>' + humanSize(row.sizeBytes) + '</td>';
    html += '</tr>';
    return html;
  }

  function renderTable() {
    var list = currentRows();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (view.page > pages) view.page = pages;
    if (view.page < 1) view.page = 1;

    var offset = (view.page - 1) * PAGE_SIZE;
    var slice = list.slice(offset, offset + PAGE_SIZE);

    var html = '';
    for (var i = 0; i < slice.length; i++) {
      html += rowHtml(slice[i], offset + i + 1);
    }
    dom.tableBody.innerHTML = html;

    var from = list.length ? offset + 1 : 0;
    var to = offset + slice.length;
    dom.pageInfo.textContent = 'Стр. ' + view.page + ' из ' + pages +
      ' · показано ' + from + '–' + to + ' из ' + list.length;
    dom.pagePrev.disabled = view.page <= 1 || !list.length;
    dom.pageNext.disabled = view.page >= pages || !list.length;
  }

  function propRow(label, valueHtml) {
    return '<tr><th scope="row">' + esc(label) + '</th><td>' + valueHtml + '</td></tr>';
  }

  function extraValueHtml(value) {
    if (value == null || value === '') return '<p>—</p>';
    if (isMatrix(value)) {
      var html = '<table class="matrix"><tbody>';
      value.forEach(function (rowValues) {
        html += '<tr>';
        rowValues.forEach(function (cell) {
          html += '<td>' + esc(cell) + '</td>';
        });
        html += '</tr>';
      });
      return html + '</tbody></table>';
    }
    return '<p>' + esc(value) + '</p>';
  }

  function openDrawer(row) {
    var result = row.result;

    dom.drawerTitle.textContent = row.name;

    var html = '<h3>Характеристики изображения</h3><table><tbody>';
    html += propRow('Формат',
      '<span class="badge ' + (BADGE_CLASSES[result.format] || '') + '">' +
      esc(result.format) + '</span>');
    html += propRow('Размер, px', result.width != null && result.height != null
      ? esc(result.width) + ' × ' + esc(result.height) : '—');
    html += propRow('Разрешение, dpi', esc(dpiText(result)));
    html += propRow('Глубина цвета',
      result.bitDepthText != null ? esc(result.bitDepthText) : '—');
    html += propRow('Сжатие', result.compression != null ? esc(result.compression) : '—');
    html += '</tbody></table>';

    html += '<h3>Файл</h3><table><tbody>';
    html += propRow('Имя', esc(row.name));
    if (row.dir) html += propRow('Папка', esc(row.dir));
    html += propRow('Размер', esc(row.sizeBytes.toLocaleString('ru-RU')) + ' Б (' +
      esc(humanSize(row.sizeBytes)) + ')');
    html += propRow('Изменён', esc(new Date(row.lastModified).toLocaleString('ru-RU')));
    html += '</tbody></table>';

    var extras = result.extras || [];
    if (extras.length) {
      html += '<h3>Дополнительные характеристики</h3>';
      extras.forEach(function (extra) {
        html += '<h4>' + esc(extra.name) + '</h4>';
        html += extraValueHtml(extra.value);
        if (extra.description) html += '<p>' + esc(extra.description) + '</p>';
      });
    }

    dom.drawerBody.innerHTML = html;
    dom.drawerBody.scrollTop = 0;
    show(dom.drawer);
    show(dom.drawerOverlay);
  }

  function closeDrawer() {
    hide(dom.drawer);
    hide(dom.drawerOverlay);
  }

  function csvCell(value) {
    if (value == null) return '';
    var text = String(value);
    if (/[";\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function extraValueText(value) {
    if (value == null) return '';
    if (isMatrix(value)) {
      return value.map(function (rowValues) { return rowValues.join(' '); }).join(' | ');
    }
    return String(value);
  }

  function exportCsv() {
    var lines = ['\uFEFF№;Имя файла;Формат;Ширина;Высота;DPI X;DPI Y;Глубина цвета;Сжатие;' +
      'Доп. характеристики;Размер файла (байт)'];

    currentRows().forEach(function (row, i) {
      if (row.status !== 'ok') return;
      var result = row.result;
      var extras = (result.extras || []).map(function (extra) {
        return extra.name + ': ' + extraValueText(extra.value);
      }).join(' | ');

      lines.push([
        i + 1,
        displayName(row),
        result.format,
        result.width,
        result.height,
        result.dpiX,
        result.dpiY,
        result.bitDepthText != null ? result.bitDepthText : result.bitDepth,
        result.compression,
        extras,
        row.sizeBytes
      ].map(csvCell).join(';'));
    });

    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'images-info.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function resetAll() {
    runToken++;
    rows = [];
    view = { filter: 'all', query: '', sortKey: null, sortDir: 'asc', page: 1 };

    dom.folderInput.value = '';
    dom.filesInput.value = '';
    dom.filterSearch.value = '';
    clearTimeout(searchTimer);

    dom.tableBody.innerHTML = '';
    dom.formatChips.innerHTML = '';
    dom.pageInfo.textContent = '';
    dom.pagePrev.disabled = true;
    dom.pageNext.disabled = true;

    hide(dom.progressWrap);
    hide(dom.summary);
    closeDrawer();
    hide(dom.helpModal);

    dom.btnCsv.disabled = true;
    dom.btnClear.disabled = true;
    updateSortHeaders();
  }

  dom.folderInput.addEventListener('change', onInputChange);
  dom.filesInput.addEventListener('change', onInputChange);

  dom.dropzone.addEventListener('dragenter', function (event) {
    stopEvent(event);
    dom.dropzone.classList.add('dragover');
  });
  dom.dropzone.addEventListener('dragover', function (event) {
    stopEvent(event);
    dom.dropzone.classList.add('dragover');
  });
  dom.dropzone.addEventListener('dragleave', function () {
    dom.dropzone.classList.remove('dragover');
  });
  dom.dropzone.addEventListener('drop', onDrop);

  document.addEventListener('dragover', function (event) { event.preventDefault(); });
  document.addEventListener('drop', function (event) { event.preventDefault(); });

  dom.formatChips.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    view.filter = chip.getAttribute('data-filter') || 'all';
    view.page = 1;
    renderChips();
    renderTable();
  });

  dom.filterSearch.addEventListener('input', function () {
    var value = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      view.query = value.trim().toLowerCase();
      view.page = 1;
      renderTable();
    }, SEARCH_DEBOUNCE_MS);
  });

  dom.tableHead.addEventListener('click', function (event) {
    var th = event.target.closest('th[data-sort]');
    if (!th) return;
    var key = th.getAttribute('data-sort');
    if (view.sortKey === key) {
      view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      view.sortKey = key;
      view.sortDir = 'asc';
    }
    updateSortHeaders();
    view.page = 1;
    renderTable();
  });

  dom.tableBody.addEventListener('click', function (event) {
    var tr = event.target.closest('tr[data-idx]');
    if (!tr) return;
    var row = rows[Number(tr.getAttribute('data-idx'))];
    if (row && row.status === 'ok') openDrawer(row);
  });

  dom.pagePrev.addEventListener('click', function () {
    if (view.page > 1) {
      view.page--;
      renderTable();
    }
  });
  dom.pageNext.addEventListener('click', function () {
    view.page++;
    renderTable();
  });

  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.drawerOverlay.addEventListener('click', closeDrawer);

  dom.btnCsv.addEventListener('click', exportCsv);
  dom.btnClear.addEventListener('click', resetAll);

  dom.btnHelp.addEventListener('click', function () {
    if (isVisible(dom.helpModal)) hide(dom.helpModal);
    else show(dom.helpModal);
  });
  dom.helpClose.addEventListener('click', function () { hide(dom.helpModal); });
  dom.helpModal.addEventListener('click', function (event) {
    if (event.target === dom.helpModal) hide(dom.helpModal);
  });
})();
