(function (root) {
  'use strict';

  function rd8(bytes, off) {
    return (off >= 0 && off < bytes.length) ? bytes[off] : null;
  }

  function rdU32be(bytes, off) {
    if (off < 0 || off + 4 > bytes.length) return null;
    return ((bytes[off] << 24) | (bytes[off + 1] << 16) |
            (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
  }

  function chunkType(bytes, off) {
    if (off < 0 || off + 4 > bytes.length) return null;
    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  var COLOR_NAMES = {
    0: 'Grayscale (1 канал)',
    2: 'Truecolor RGB (3 канала)',
    3: 'Indexed — палитра (1 канал)',
    4: 'Grayscale+Alpha (2 канала)',
    6: 'RGBA (4 канала)'
  };

  var CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

  function parsePng(bytes, fileSize) {
    var SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (var s = 0; s < 8; s++) {
      if (rd8(bytes, s) !== SIG[s]) {
        throw new Error('Файл не является PNG');
      }
    }

    var p = 8;
    var ihdrLen = rdU32be(bytes, p);
    var ihdrType = chunkType(bytes, p + 4);
    if (ihdrLen === null || ihdrType === null || ihdrType !== 'IHDR') {
      throw new Error('Отсутствует чанк IHDR — в PNG он должен идти первым');
    }

    var width = rdU32be(bytes, p + 8);
    var height = rdU32be(bytes, p + 12);
    var depthByte = rd8(bytes, p + 16);
    var colorByte = rd8(bytes, p + 17);
    var compressionByte = rd8(bytes, p + 18);
    var filterByte = rd8(bytes, p + 19);
    var interlaceByte = rd8(bytes, p + 20);
    if (ihdrLen < 13 || width === null || height === null || depthByte === null ||
        colorByte === null || compressionByte === null || filterByte === null ||
        interlaceByte === null) {
      throw new Error('Чанк IHDR обрезан: не хватает данных заголовка');
    }
    if (!(colorByte in COLOR_NAMES)) {
      throw new Error('Недопустимый тип цвета PNG: ' + colorByte);
    }
    if (compressionByte !== 0) {
      throw new Error('Неизвестный метод сжатия PNG: ' + compressionByte);
    }
    if (filterByte !== 0) {
      throw new Error('Неизвестный метод фильтрации PNG: ' + filterByte);
    }
    if (interlaceByte !== 0 && interlaceByte !== 1) {
      throw new Error('Недопустимый флаг интерлейса PNG: ' + interlaceByte);
    }

    var channels = CHANNELS[colorByte];
    var isIndexed = colorByte === 3;
    var bitDepth = isIndexed ? depthByte : depthByte * channels;
    var bitDepthText = isIndexed
      ? depthByte + ' ' + plural(depthByte, 'бит/пиксель', 'бита/пиксель', 'бит/пиксель') + ' (палитра)'
      : depthByte + ' ' + plural(depthByte, 'бит', 'бита', 'бит') + ' × ' +
        channels + ' ' + plural(channels, 'канал', 'канала', 'каналов');

    var dpiX = null;
    var dpiY = null;
    var paletteColors = null;
    p += 12 + ihdrLen;

    while (p + 8 <= bytes.length) {
      var clen = rdU32be(bytes, p);
      var ctype = chunkType(bytes, p + 4);
      if (clen === null || ctype === null || p + 8 + clen > bytes.length) {
        break;
      }
      if (ctype === 'IEND') break;

      if (ctype === 'pHYs' && clen >= 9) {
        var ppux = rdU32be(bytes, p + 8);
        var ppuy = rdU32be(bytes, p + 12);
        var unit = rd8(bytes, p + 16);
        if (ppux !== null && ppuy !== null && unit === 1) {
          dpiX = Math.round(ppux * 0.0254);
          dpiY = Math.round(ppuy * 0.0254);
        }

      } else if (ctype === 'PLTE') {
        paletteColors = clen / 3;
      }

      p += 12 + clen;
    }

    var extras = [];

    extras.push({
      name: 'Тип цвета',
      value: colorByte + ' — ' + COLOR_NAMES[colorByte],
      description: 'Тип цвета из чанка IHDR (байт 9 данных чанка): определяет состав и число каналов — от оттенков серого до RGBA с альфа-каналом; для Indexed пиксели хранят индексы в палитре PLTE.'
    });

    extras.push({
      name: 'Интерлейс (чересстрочность)',
      value: interlaceByte === 1 ? 'Adam7' : 'нет',
      description: 'Флаг чересстрочности из чанка IHDR (байт 12 данных чанка): Adam7 передаёт изображение семью проходами от грубого к детальному, поэтому картинка постепенно проявляется уже во время загрузки по медленному каналу.'
    });

    extras.push({
      name: 'Число бит на канал',
      value: depthByte + ' ' + plural(depthByte, 'бит', 'бита', 'бит'),
      description: 'Глубина одного канала из чанка IHDR (байт 8 данных чанка): допустимы 1, 2, 4, 8 и 16 бит на канал; суммарная глубина пикселя — биты на канал × число каналов типа цвета.'
    });

    if (paletteColors !== null) {
      extras.push({
        name: 'Число цветов палитры',
        value: paletteColors,
        description: 'Размер таблицы цветов из чанка PLTE: каждый цвет занимает 3 байта RGB, число цветов = длина данных чанка / 3; используется при типе цвета Indexed.'
      });
    }

    return {
      format: 'PNG',
      width: width,
      height: height,
      dpiX: dpiX,
      dpiY: dpiY,
      bitDepth: bitDepth,
      bitDepthText: bitDepthText,
      compression: 'Deflate (zlib), без потерь',
      extras: extras
    };
  }

  root.ImgInfo = root.ImgInfo || {};
  root.ImgInfo.png = parsePng;
})(typeof self !== 'undefined' ? self : globalThis);
