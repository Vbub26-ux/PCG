(function (root) {
  'use strict';

  var ZIGZAG = [
     0,  1,  8, 16,  9,  2,  3, 10,
    17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
  ];

  var SOF_VARIANTS = {
    0xC0: 'SOF0 — базовое последовательное DCT (baseline), кодирование Хаффмана',
    0xC1: 'SOF1 — расширенное последовательное DCT, кодирование Хаффмана',
    0xC2: 'SOF2 — прогрессивное DCT, кодирование Хаффмана',
    0xC3: 'SOF3 — без потерь (lossless, без DCT), кодирование Хаффмана',
    0xC5: 'SOF5 — дифференциальное последовательное DCT, кодирование Хаффмана',
    0xC6: 'SOF6 — дифференциальное прогрессивное DCT, кодирование Хаффмана',
    0xC7: 'SOF7 — дифференциальное без потерь, кодирование Хаффмана',
    0xC9: 'SOF9 — расширенное последовательное DCT, арифметическое кодирование',
    0xCA: 'SOF10 — прогрессивное DCT, арифметическое кодирование',
    0xCB: 'SOF11 — без потерь, арифметическое кодирование',
    0xCD: 'SOF13 — дифференциальное последовательное DCT, арифметическое кодирование',
    0xCE: 'SOF14 — дифференциальное прогрессивное DCT, арифметическое кодирование',
    0xCF: 'SOF15 — дифференциальное без потерь, арифметическое кодирование'
  };

  function rd8(bytes, off) {
    return (off >= 0 && off < bytes.length) ? bytes[off] : null;
  }

  function rdU16(bytes, off, le) {
    if (off < 0 || off + 1 >= bytes.length) return null;
    return le ? (bytes[off] | (bytes[off + 1] << 8)) : ((bytes[off] << 8) | bytes[off + 1]);
  }

  function rdU32(bytes, off, le) {
    if (off < 0 || off + 3 >= bytes.length) return null;
    if (le) {
      return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16)) + bytes[off + 3] * 0x1000000;
    }
    return bytes[off] * 0x1000000 + ((bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]);
  }

  function rdRational(bytes, off, le) {
    var num = rdU32(bytes, off, le);
    var den = rdU32(bytes, off + 4, le);
    if (num === null || den === null || den === 0) return null;
    return num / den;
  }

  function rdAscii(bytes, off, count) {
    var s = '';
    for (var i = 0; i < count && off + i < bytes.length; i++) {
      var b = bytes[off + i];
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    return s.replace(/^\s+|\s+$/g, '');
  }

  function isSof(code) {
    return code >= 0xC0 && code <= 0xCF && code !== 0xC4 && code !== 0xC8 && code !== 0xCC;
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  function subsamplingText(comps) {
    if (comps.length < 3) return 'не применяется (компонентов меньше трёх)';
    var y = comps[0];
    var allOne = true;
    var chromaOne = true;
    for (var i = 0; i < comps.length; i++) {
      if (comps[i].h !== 1 || comps[i].v !== 1) allOne = false;
      if (i > 0 && (comps[i].h !== 1 || comps[i].v !== 1)) chromaOne = false;
    }
    if (allOne) return '4:4:4';
    if (y.h === 2 && y.v === 2 && chromaOne) return '4:2:0';
    if (y.h === 2 && y.v === 1) return '4:2:2';
    if (y.h === 4 && y.v === 1) return '4:1:1';
    var parts = [];
    for (var j = 0; j < comps.length; j++) parts.push(comps[j].h + '×' + comps[j].v);
    return parts.join(', ');
  }

  function parseExif(bytes, dataStart, dataEnd) {
    var out = {};
    if (dataEnd - dataStart < 14) return out;
    if (rd8(bytes, dataStart) !== 0x45 || rd8(bytes, dataStart + 1) !== 0x78 ||
        rd8(bytes, dataStart + 2) !== 0x69 || rd8(bytes, dataStart + 3) !== 0x66 ||
        rd8(bytes, dataStart + 4) !== 0x00 || rd8(bytes, dataStart + 5) !== 0x00) {
      return out;
    }
    var tiff = dataStart + 6;
    var le;
    var b0 = rd8(bytes, tiff), b1 = rd8(bytes, tiff + 1);
    if (b0 === 0x49 && b1 === 0x49) le = true;
    else if (b0 === 0x4D && b1 === 0x4D) le = false;
    else return out;
    if (rdU16(bytes, tiff + 2, le) !== 42) return out;
    var ifdOff = rdU32(bytes, tiff + 4, le);
    if (ifdOff === null) return out;
    var ifd = tiff + ifdOff;
    var n = rdU16(bytes, ifd, le);
    if (n === null || n > 1000) return out;
    var p = ifd + 2;
    for (var e = 0; e < n; e++) {
      if (p + 12 > dataEnd) break;
      var tag = rdU16(bytes, p, le);
      var type = rdU16(bytes, p + 2, le);
      var count = rdU32(bytes, p + 4, le);
      if (tag === null || type === null || count === null) break;
      var size = (type === 1 || type === 2) ? 1 : (type === 3) ? 2 : (type === 4) ? 4 : (type === 5) ? 8 : 0;
      if (size === 0 || count > 0x10000) { p += 12; continue; }
      var valAbs;
      if (size * count <= 4) {
        valAbs = p + 8;
      } else {
        var rel = rdU32(bytes, p + 8, le);
        if (rel === null) { p += 12; continue; }
        valAbs = tiff + rel;
      }
      switch (tag) {
        case 0x011A: { var xr = rdRational(bytes, valAbs, le); if (xr !== null) out.xRes = xr; break; }
        case 0x011B: { var yr = rdRational(bytes, valAbs, le); if (yr !== null) out.yRes = yr; break; }
        case 0x0128: { var un = rdU16(bytes, valAbs, le); if (un !== null) out.unit = un; break; }
        case 0x010F: out.make = rdAscii(bytes, valAbs, count); break;
        case 0x0110: out.model = rdAscii(bytes, valAbs, count); break;
      }
      p += 12;
    }
    return out;
  }

  function parseJpeg(bytes, fileSize) {
    if (!bytes || bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      throw new Error('Файл не является JPEG (нет маркера SOI)');
    }

    var jfifDpiX = null, jfifDpiY = null;
    var exif = null;
    var dqtTables = [];
    var comments = [];
    var sof = null;

    var i = 2;
    var scanEnded = false;

    while (!scanEnded) {
      while (i < bytes.length && bytes[i] !== 0xFF) i++;
      if (i >= bytes.length) break;
      while (i < bytes.length && bytes[i] === 0xFF) i++;
      if (i >= bytes.length) break;
      var code = bytes[i];
      i++;
      if (code === 0x00) continue;
      if (code === 0x01 || (code >= 0xD0 && code <= 0xD7)) continue;
      if (code === 0xD9 || code === 0xDA) { scanEnded = true; break; }

      var len = rdU16(bytes, i, false);
      if (len === null) break;
      if (len < 2) { i += 2; continue; }
      var dataStart = i + 2;
      var dataEnd = dataStart + len - 2;
      if (dataEnd > bytes.length) break;
      i = dataEnd;

      if (code === 0xE0) {
        if (dataEnd - dataStart >= 12 &&
            rd8(bytes, dataStart) === 0x4A && rd8(bytes, dataStart + 1) === 0x46 &&
            rd8(bytes, dataStart + 2) === 0x49 && rd8(bytes, dataStart + 3) === 0x46 &&
            rd8(bytes, dataStart + 4) === 0x00) {
          var units = rd8(bytes, dataStart + 7);
          var xd = rdU16(bytes, dataStart + 8, false);
          var yd = rdU16(bytes, dataStart + 10, false);
          if (xd !== null && xd > 0 && yd !== null && yd > 0) {
            if (units === 2) { jfifDpiX = xd; jfifDpiY = yd; }
            else if (units === 3) {
              jfifDpiX = Math.round(xd * 2.54);
              jfifDpiY = Math.round(yd * 2.54);
            }
          }
        }
      } else if (code === 0xE1) {
        var e = parseExif(bytes, dataStart, dataEnd);
        if (exif === null &&
            (e.xRes !== undefined || e.yRes !== undefined || e.make || e.model)) {
          exif = e;
        }
      } else if (code === 0xDB) {
        var p = dataStart;
        while (p < dataEnd) {
          var pqTq = rd8(bytes, p);
          if (pqTq === null) break;
          var pq = pqTq >> 4;
          var tq = pqTq & 0x0F;
          if (pq !== 0 && pq !== 1) break;
          var w = (pq === 1) ? 2 : 1;
          if (p + 1 + 64 * w > dataEnd) break;
          var zig = [];
          for (var k = 0; k < 64; k++) {
            zig.push(w === 1 ? rd8(bytes, p + 1 + k) : rdU16(bytes, p + 1 + k * 2, false));
          }
          p += 1 + 64 * w;
          var natural = new Array(64);
          for (var z = 0; z < 64; z++) natural[ZIGZAG[z]] = zig[z];
          var matrix = [];
          for (var r = 0; r < 8; r++) {
            var row = [];
            for (var c = 0; c < 8; c++) row.push(natural[r * 8 + c]);
            matrix.push(row);
          }
          dqtTables.push({ tq: tq, bits: w * 8, matrix: matrix });
        }
      } else if (isSof(code)) {
        if (sof === null && dataEnd - dataStart >= 6) {
          var prec = rd8(bytes, dataStart);
          var hgt = rdU16(bytes, dataStart + 1, false);
          var wdt = rdU16(bytes, dataStart + 3, false);
          var nC = rd8(bytes, dataStart + 5);
          if (prec !== null && hgt !== null && wdt !== null && nC !== null && nC > 0) {
            var comps = [];
            var q = dataStart + 6;
            var valid = true;
            for (var ci = 0; ci < nC; ci++) {
              if (q + 3 > dataEnd) { valid = false; break; }
              comps.push({
                id: rd8(bytes, q),
                h: rd8(bytes, q + 1) >> 4,
                v: rd8(bytes, q + 1) & 0x0F,
                quant: rd8(bytes, q + 2)
              });
              q += 3;
            }
            if (valid) sof = { code: code, precision: prec, width: wdt, height: hgt, comps: comps };
          }
        }
      } else if (code === 0xFE) {
        var s = '';
        for (var t = dataStart; t < dataEnd; t++) {
          var b = bytes[t];
          if (b === 0) break;
          if (b >= 32) s += String.fromCharCode(b);
        }
        s = s.replace(/^\s+|\s+$/g, '');
        if (s) comments.push(s);
      }
    }

    if (sof === null) {
      if (scanEnded) throw new Error('В JPEG не найден маркер SOF');
      return { needMoreBytes: true };
    }

    var dpiX = null, dpiY = null;
    if (jfifDpiX !== null) {
      dpiX = jfifDpiX;
      dpiY = jfifDpiY;
    } else if (exif) {
      var mult = (exif.unit === 3) ? 2.54 : 1;
      if (typeof exif.xRes === 'number') dpiX = Math.round(exif.xRes * mult);
      if (typeof exif.yRes === 'number') dpiY = Math.round(exif.yRes * mult);
    }

    var compression;
    if (sof.code === 0xC0 || sof.code === 0xC1) compression = 'JPEG (DCT, baseline, Huffman)';
    else if (sof.code === 0xC2) compression = 'JPEG (DCT, progressive, Huffman)';
    else compression = 'JPEG (lossless, Huffman)';

    var n = sof.comps.length;
    var extras = [];

    extras.push({
      name: 'Вариант кодирования',
      value: SOF_VARIANTS[sof.code] || ('SOF с кодом 0x' + sof.code.toString(16).toUpperCase()),
      description: 'Схема кодирования JPEG, определяемая кодом маркера SOF (SOF0…SOF15) в заголовке потока: способ DCT-кодирования (baseline, прогрессивный или без потерь) и тип энтропийного кодера.'
    });
    extras.push({
      name: 'Число компонентов',
      value: n,
      description: 'Количество цветовых компонентов из маркера SOF: 1 — градации серого, 3 — цветное изображение (Y, Cb, Cr), 4 — CMYK.'
    });
    extras.push({
      name: 'Субдискретизация цветоразностных каналов',
      value: subsamplingText(sof.comps),
      description: 'Факторы сэмплинга H×V компонентов из маркера SOF: частота дискретизации цветоразностных каналов Cb/Cr относительно яркостного Y; чем она ниже, тем сильнее сжатие и хуже цветовая точность.'
    });
    if (comments.length > 0) {
      extras.push({
        name: 'Комментарий',
        value: comments.join('\n'),
        description: 'Текстовая строка из маркера COM (0xFFFE) — произвольный комментарий, встроенный в файл программой или устройством при сохранении.'
      });
    }
    for (var d = 0; d < dqtTables.length; d++) {
      extras.push({
        name: 'Таблица квантования #' + dqtTables[d].tq + ' (' + dqtTables[d].bits + ' бит)',
        value: dqtTables[d].matrix,
        description: 'Матрица шагов квантования DCT-коэффициентов из маркера DQT — задаёт степень сжатия и качество JPEG.'
      });
    }
    if (exif && (exif.make || exif.model)) {
      var cam = (exif.make && exif.model) ? (exif.make + ' ' + exif.model) : (exif.make || exif.model);
      extras.push({
        name: 'Камера (Exif)',
        value: cam,
        description: 'Производитель и модель съёмочной аппаратуры из Exif-записи маркера APP1 (теги TIFF Make 0x010F и Model 0x0110).'
      });
    }

    return {
      format: 'JPEG',
      width: sof.width,
      height: sof.height,
      dpiX: dpiX,
      dpiY: dpiY,
      bitDepth: sof.precision * n,
      bitDepthText: sof.precision + ' ' + plural(sof.precision, 'бит', 'бита', 'бит') +
        ' × ' + n + ' ' + plural(n, 'канал', 'канала', 'каналов'),
      compression: compression,
      extras: extras
    };
  }

  root.ImgInfo = root.ImgInfo || {};
  root.ImgInfo.jpeg = parseJpeg;
})(typeof self !== 'undefined' ? self : globalThis);
