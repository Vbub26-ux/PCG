(function (root) {
  'use strict';

  function rdU16le(bytes, off) {
    if (off < 0 || off + 1 >= bytes.length) return null;
    return bytes[off] | (bytes[off + 1] << 8);
  }

  function rdU32le(bytes, off) {
    if (off < 0 || off + 3 >= bytes.length) return null;
    return ((bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) |
             (bytes[off + 3] << 24)) >>> 0);
  }

  function rdS32le(bytes, off) {
    if (off < 0 || off + 3 >= bytes.length) return null;
    return bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) |
           (bytes[off + 3] << 24);
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  function ppmToDpi(ppm) {
    if (ppm === null || ppm <= 0) return null;
    return Math.round(ppm * 0.0254);
  }

  var COMPRESSIONS = {
    0: 'BI_RGB (без сжатия)',
    1: 'BI_RLE8 (RLE, 8 бит)',
    2: 'BI_RLE4 (RLE, 4 бита)',
    3: 'BI_BITFIELDS (битовые поля)',
    4: 'JPEG',
    5: 'PNG',
    6: 'BI_BITFIELDS (HALF)'
  };

  function parseBmp(bytes, fileSize) {
    if (rdU16le(bytes, 0) !== 0x4D42) {
      throw new Error('Файл не является BMP');
    }

    var fileSizeField = rdU32le(bytes, 2);
    var pixelOffset = rdU32le(bytes, 10);
    if (fileSizeField === null || pixelOffset === null) {
      throw new Error('Заголовок BMP обрезан: не хватает данных BITMAPFILEHEADER (14 байт)');
    }

    var dibSize = rdU32le(bytes, 14);
    if (dibSize === null) {
      throw new Error('Заголовок BMP обрезан: не хватает поля размера DIB-заголовка');
    }

    var width, height, planes, bpp;
    var compressionCode = 0;
    var xppm = null, yppm = null;
    var clrUsed = null, clrImportant = null;
    var versionText;

    if (dibSize === 12) {
      width = rdU16le(bytes, 18);
      height = rdU16le(bytes, 20);
      planes = rdU16le(bytes, 22);
      bpp = rdU16le(bytes, 24);
      if (width === null || height === null || planes === null || bpp === null) {
        throw new Error('Заголовок BMP обрезан: не хватает данных BITMAPCOREHEADER (12 байт)');
      }
      versionText = 'BITMAPCOREHEADER (OS/2 и Windows 1.x)';
    } else if (dibSize >= 40) {
      var w = rdS32le(bytes, 18);
      var h = rdS32le(bytes, 22);
      planes = rdU16le(bytes, 26);
      bpp = rdU16le(bytes, 28);
      compressionCode = rdU32le(bytes, 30);
      var imageSize = rdS32le(bytes, 34);
      xppm = rdS32le(bytes, 38);
      yppm = rdS32le(bytes, 42);
      clrUsed = rdU32le(bytes, 46);
      clrImportant = rdU32le(bytes, 50);
      if (w === null || h === null || planes === null || bpp === null ||
          compressionCode === null || imageSize === null || xppm === null ||
          yppm === null || clrUsed === null || clrImportant === null) {
        throw new Error('Заголовок BMP обрезан: не хватает данных DIB-заголовка (40 байт)');
      }
      width = Math.abs(w);
      height = Math.abs(h);
      versionText =
        dibSize === 40 ? 'BITMAPINFOHEADER (Windows 3.x)' :
        dibSize === 108 ? 'BITMAPV4HEADER' :
        dibSize === 124 ? 'BITMAPV5HEADER' :
        'неизвестный DIB-заголовок (' + dibSize + ' байт)';
    } else {
      throw new Error('Неизвестный размер DIB-заголовка: ' + dibSize + ' байт');
    }

    var dpiX = ppmToDpi(xppm);
    var dpiY = ppmToDpi(yppm);

    var bitDepth = bpp;
    var bitDepthText = bpp + ' ' + plural(bpp, 'бит', 'бита', 'бит') + '/пиксель' +
      (bpp <= 8 ? ' (палитра)' : '');

    var compression = COMPRESSIONS[compressionCode] ||
      'неизвестный метод сжатия (код ' + compressionCode + ')';

    var extras = [];

    extras.push({
      name: 'Версия заголовка',
      value: versionText,
      description: 'Определяется полем размера DIB-заголовка (u32 по смещению 14, сразу после BITMAPFILEHEADER): 12 байт — BITMAPCOREHEADER, 40 — BITMAPINFOHEADER, 108 — BITMAPV4HEADER, 124 — BITMAPV5HEADER.'
    });

    extras.push({
      name: 'Число цветовых плоскостей',
      value: planes,
      description: 'Поле biPlanes (u16) DIB-заголовка: число цветовых плоскостей устройства вывода; по спецификации всегда равно 1, иные значения чтением игнорируются.'
    });

    var paletteColors;
    if (clrUsed !== null && clrUsed !== 0) {
      paletteColors = clrUsed;
    } else if (bpp <= 8) {
      paletteColors = 1 << bpp;
    } else {
      paletteColors = 'нет';
    }

    extras.push({
      name: 'Число цветов палитры',
      value: paletteColors,
      description: 'Из поля biClrUsed (u32 по смещению 46, есть только в заголовках от 40 байт): ненулевое значение — число цветов, реально записанных в файле; ноль при глубине ≤8 бит означает полную палитру из 2^bpp цветов (в BITMAPCOREHEADER палитра всегда полная), при большей глубине палитры нет. Сами записи палитры лежат между DIB-заголовком и пиксельными данными — до смещения из поля bfOffBits (u32 по смещению 10) файла.'
    });

    return {
      format: 'BMP',
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
  root.ImgInfo.bmp = parseBmp;
})(typeof self !== 'undefined' ? self : globalThis);
