(function (root) {
  'use strict';

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

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  var COMPRESSION_NAMES = {
    1:     'без сжатия',
    2:     'CCITT RLE (Хаффман)',
    3:     'CCITT Group 3',
    4:     'CCITT Group 4',
    5:     'LZW',
    6:     'JPEG (старый)',
    7:     'JPEG',
    8:     'Deflate (Adobe)',
    32766: 'NeXT RLE',
    32773: 'PackBits',
    32909: 'Deflate',
    34712: 'JPEG 2000'
  };

  var PHOTOMETRIC_NAMES = {
    0: 'WhiteIsZero (ч/б, инверсия)',
    1: 'BlackIsZero (ч/б)',
    2: 'RGB',
    3: 'палитра',
    4: 'маска прозрачности',
    5: 'CMYK',
    6: 'YCbCr'
  };

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

  function readTagValue(bytes, p, le, fileSize) {
    var type = rdU16(bytes, p + 2, le);
    var count = rdU32(bytes, p + 4, le);
    if (type === null || count === null) return null;
    var size = TYPE_SIZE[type];
    if (!size || count === 0 || count > 0x10000) return null;
    var total = size * count;
    var off;
    if (total <= 4) {
      off = p + 8;
    } else {
      var rel = rdU32(bytes, p + 8, le);
      if (rel === null) return null;
      if (rel + total > fileSize) return null;
      if (rel + total > bytes.length) return { more: true };
      off = rel;
    }
    if (type === 2) return { str: rdAscii(bytes, off, count) };
    var nums = [];
    for (var i = 0; i < count; i++) {
      var q = off + i * size;
      if (type === 1) nums.push(rd8(bytes, q));
      else if (type === 3) nums.push(rdU16(bytes, q, le));
      else if (type === 4) nums.push(rdU32(bytes, q, le));
      else nums.push(rdRational(bytes, q, le));
    }
    return { nums: nums };
  }

  function countPages(bytes, fileSize, firstIfdOff, le) {
    var pages = 0;
    var off = firstIfdOff;
    var seen = [];
    while (off !== 0) {
      if (seen.indexOf(off) !== -1) break;
      seen.push(off);
      if (off < 8 || off + 2 > fileSize) break;
      var n = rdU16(bytes, off, le);
      if (n === null) break;
      if (off + 2 + n * 12 + 4 > fileSize) break;
      var next = rdU32(bytes, off + 2 + n * 12, le);
      if (next === null) break;
      pages++;
      off = next;
    }
    return pages;
  }

  function parseTiff(bytes, fileSize) {
    if (!bytes || bytes.length < 2 ||
        !((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D))) {
      throw new Error('Файл не является TIFF');
    }
    if (!fileSize || fileSize < bytes.length) fileSize = bytes.length;
    var le = bytes[0] === 0x49;
    if (bytes.length < 8) return { needMoreBytes: true };
    if (rdU16(bytes, 2, le) !== 42) throw new Error('Файл не является TIFF');
    var ifdOff = rdU32(bytes, 4, le);
    if (ifdOff === null || ifdOff < 8 || ifdOff >= fileSize) {
      throw new Error('Файл не является TIFF');
    }
    if (ifdOff + 2 > bytes.length) return { needMoreBytes: true };

    var n = rdU16(bytes, ifdOff, le);
    if (n === null) return { needMoreBytes: true };
    if (ifdOff + 2 + n * 12 > fileSize) {
      throw new Error('Файл TIFF повреждён: записи IFD выходят за пределы файла');
    }
    if (ifdOff + 2 + n * 12 + 4 > bytes.length) return { needMoreBytes: true };

    var vals = {};
    var needMore = false;
    for (var e = 0; e < n; e++) {
      var p = ifdOff + 2 + e * 12;
      var tag = rdU16(bytes, p, le);
      if (tag === null) break;
      var v = readTagValue(bytes, p, le, fileSize);
      if (v === null) continue;
      if (v.more) { needMore = true; continue; }
      vals[tag] = v;
    }
    if (needMore) return { needMoreBytes: true };

    function num(tag) {
      var x = vals[tag];
      return (x && x.nums && x.nums.length > 0 && typeof x.nums[0] === 'number') ? x.nums[0] : null;
    }
    function str(tag) {
      var x = vals[tag];
      return (x && x.str) ? x.str : null;
    }

    var width = num(0x0100);
    var height = num(0x0101);
    if (width === null || height === null) {
      throw new Error('В TIFF не найдены размеры изображения (теги ImageWidth/ImageLength)');
    }

    var samples = num(0x0115);
    if (samples === null) samples = 1;
    var bitsArr = (vals[0x0102] && vals[0x0102].nums)
      ? vals[0x0102].nums.filter(function (b) { return typeof b === 'number'; })
      : null;
    if (!bitsArr || bitsArr.length === 0) {
      bitsArr = [];
      for (var s = 0; s < samples; s++) bitsArr.push(1);
    }
    var bitDepth = 0;
    for (var s2 = 0; s2 < bitsArr.length; s2++) bitDepth += bitsArr[s2];
    var same = true;
    for (var i = 1; i < bitsArr.length; i++) if (bitsArr[i] !== bitsArr[0]) same = false;
    var bitDepthText = (same
        ? bitsArr[0] + ' ' + plural(bitsArr[0], 'бит', 'бита', 'бит')
        : bitsArr.join('+') + ' бит') +
      ' × ' + bitsArr.length + ' ' + plural(bitsArr.length, 'канал', 'канала', 'каналов');

    var compCode = num(0x0103);
    if (compCode === null) compCode = 1;
    var compression = COMPRESSION_NAMES[compCode] || ('код ' + compCode);

    var photo = num(0x0106);
    var photoText = photo === null ? 'не указана' : (PHOTOMETRIC_NAMES[photo] || ('код ' + photo));
    var planar = num(0x011C);
    var planarText = (planar === 2) ? 'planar' : 'chunky';

    var xres = num(0x011A);
    var yres = num(0x011B);
    var unit = num(0x0128);
    if (unit === null) unit = 2;
    var dpiX = null, dpiY = null;
    if (unit !== 1) {
      var mult = (unit === 3) ? 2.54 : 1;
      if (xres !== null) dpiX = Math.round(xres * mult);
      if (yres !== null) dpiY = Math.round(yres * mult);
    }

    var extras = [];
    extras.push({
      name: 'Число каналов (SamplesPerPixel)',
      value: samples,
      description: 'Количество цветовых составляющих (сэмплов) одного пикселя из тега SamplesPerPixel (0x0115); если тег отсутствует, по спецификации TIFF 6.0 принимается равным 1.'
    });
    extras.push({
      name: 'Цветовая модель (Photometric)',
      value: photoText,
      description: 'Способ интерпретации сэмплов пикселя из тега PhotometricInterpretation (0x0106): оттенки серого, RGB, палитра, CMYK, YCbCr и т. д.'
    });
    extras.push({
      name: 'Порядок хранения каналов (PlanarConfiguration)',
      value: planarText,
      description: 'Расположение сэмплов в потоке данных из тега PlanarConfiguration (0x011C): chunky (1) — значения всех каналов пикселя хранятся вместе, planar (2) — каждый канал лежит отдельной плоскостью.'
    });
    extras.push({
      name: 'Порядок байт',
      value: le ? 'little-endian (II)' : 'big-endian (MM)',
      description: 'Порядок байтов многобайтовых чисел, задаваемый первыми двумя байтами заголовка TIFF: «II» — младший байт первым (little-endian), «MM» — старшим первым (big-endian).'
    });
    extras.push({
      name: 'Число страниц (IFD)',
      value: countPages(bytes, fileSize, ifdOff, le),
      description: 'Количество директорий изображений (IFD) в файле: после записей каждой IFD поле nextIFD хранит смещение следующей — так TIFF образует многостраничный документ; подсчитано обходом цепочки от первой IFD.'
    });
    if (str(0x010F)) {
      extras.push({
        name: 'Производитель',
        value: str(0x010F),
        description: 'Название производителя съёмочной аппаратуры из тега Make (0x010F) — ASCII-строка до нулевого байта.'
      });
    }
    if (str(0x0110)) {
      extras.push({
        name: 'Модель',
        value: str(0x0110),
        description: 'Модель камеры или иного устройства, создавшего файл, из тега Model (0x0110) — ASCII-строка до нулевого байта.'
      });
    }
    if (str(0x0131)) {
      extras.push({
        name: 'Программа',
        value: str(0x0131),
        description: 'Название программного обеспечения, создавшего файл, из тега Software (0x0131) — ASCII-строка до нулевого байта.'
      });
    }
    if (str(0x0132)) {
      extras.push({
        name: 'Дата',
        value: str(0x0132),
        description: 'Дата и время создания файла из тега DateTime (0x0132), формат «ГГГГ:ММ:ДД ЧЧ:ММ:СС».'
      });
    }
    if (str(0x010E)) {
      extras.push({
        name: 'Описание изображения',
        value: str(0x010E),
        description: 'Произвольное текстовое описание изображения из тега ImageDescription (0x010E) — ASCII-строка до нулевого байта.'
      });
    }

    return {
      format: 'TIFF',
      width: width,
      height: height,
      dpiX: dpiX,
      dpiY: dpiY,
      bitDepth: bitDepth,
      bitDepthText: bitDepthText,
      compression: compression,
      extras: extras
    };
  }

  root.ImgInfo = root.ImgInfo || {};
  root.ImgInfo.tiff = parseTiff;
})(typeof self !== 'undefined' ? self : globalThis);
