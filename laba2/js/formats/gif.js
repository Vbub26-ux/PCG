(function (root) {
  'use strict';

  function rd8(bytes, off) {
    return (off >= 0 && off < bytes.length) ? bytes[off] : null;
  }

  function rdU16le(bytes, off) {
    if (off < 0 || off + 1 >= bytes.length) return null;
    return bytes[off] | (bytes[off + 1] << 8);
  }

  function skipSubBlocks(bytes, off) {
    while (true) {
      var len = rd8(bytes, off);
      if (len === null) return null;
      if (len === 0) return off + 1;
      off += 1 + len;
    }
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  function parseGif(bytes, fileSize) {
    var sig = '';
    for (var s = 0; s < 6 && rd8(bytes, s) !== null; s++) sig += String.fromCharCode(bytes[s]);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') {
      throw new Error('Файл не является GIF');
    }
    var version = sig.substring(3);

    var width = rdU16le(bytes, 6);
    var height = rdU16le(bytes, 8);
    var packed = rd8(bytes, 10);
    var bgIndex = rd8(bytes, 11);
    var aspect = rd8(bytes, 12);
    if (width === null || height === null || packed === null ||
        bgIndex === null || aspect === null) {
      throw new Error('Заголовок GIF обрезан: не хватает данных Logical Screen Descriptor');
    }

    var gctFlag = (packed & 0x80) !== 0;
    var colorRes = (packed >> 4) & 0x07;
    var gctSize = packed & 0x07;

    var bitDepth = gctFlag ? (gctSize + 1) : (colorRes + 1);

    var frames = 0;
    var transparentIndex = null;

    var p = 13 + (gctFlag ? 3 * (1 << (gctSize + 1)) : 0);

    while (p < bytes.length) {
      var block = bytes[p];

      if (block === 0x3B) break;

      if (block === 0x21) {
        var label = rd8(bytes, p + 1);
        if (label === null) break;
        var data = p + 2;

        if (label === 0xF9) {
          var gceLen = rd8(bytes, data);
          var gcePacked = rd8(bytes, data + 1);
          if (gceLen !== null && gceLen >= 4 && gcePacked !== null && (gcePacked & 0x01) !== 0) {
            var tIdx = rd8(bytes, data + 4);
            if (tIdx !== null) transparentIndex = tIdx;
          }
        }

        var afterExt = skipSubBlocks(bytes, data);
        if (afterExt === null) break;
        p = afterExt;

      } else if (block === 0x2C) {
        var imgPacked = rd8(bytes, p + 9);
        if (imgPacked === null) break;
        frames++;

        var q = p + 10;
        if ((imgPacked & 0x80) !== 0) {
          q += 3 * (1 << ((imgPacked & 0x07) + 1));
        }
        var lzwMin = rd8(bytes, q);
        if (lzwMin === null) break;

        var afterImg = skipSubBlocks(bytes, q + 1);
        if (afterImg === null) break;
        p = afterImg;

      } else {
        break;
      }
    }

    var extras = [];

    extras.push({
      name: 'Версия GIF',
      value: version === '87a' ? '87a — базовая' : '89a — с анимацией и прозрачностью',
      description: 'Версия формата из сигнатуры файла (байты 0–5): 87a — базовый набор возможностей, 89a — расширения: анимация, прозрачность, текстовые метки и комментарии.'
    });

    if (gctFlag) {
      extras.push({
        name: 'Число цветов глобальной палитры',
        value: 1 << (gctSize + 1),
        description: 'Размер глобальной таблицы цветов (GCT), следующей сразу за Logical Screen Descriptor (с offset 13): по 3 байта RGB на цвет; количество 2^(n+1) задаётся младшими битами packed-байта LSD.'
      });
    }

    extras.push({
      name: 'Число кадров',
      value: frames + ' ' + plural(frames, 'кадр', 'кадра', 'кадров') +
        (frames > 1 ? ' (анимация)' : ''),
      description: 'Количество блоков Image Descriptor (0x2C), встреченных при обходе данных файла; больше одного кадра означает анимированный GIF.'
    });

    if (transparentIndex !== null) {
      extras.push({
        name: 'Прозрачный цвет',
        value: 'индекс ' + transparentIndex,
        description: 'Индекс палитры, помеченный прозрачным, из Graphic Control Extension (0x21 0xF9): бит 0 packed-байта подблока разрешает прозрачность, сам индекс — последний байт 4-байтового подблока.'
      });
    }

    extras.push({
      name: 'Соотношение сторон пикселя',
      value: aspect === 0 ? 'квадратный' : (aspect + 15) / 64,
      description: 'Аспект пикселя из байта Pixel Aspect Ratio в Logical Screen Descriptor (offset 12): 0 — квадратные пиксели, иначе коэффициент (v+15)/64.'
    });

    return {
      format: 'GIF',
      width: width,
      height: height,
      dpiX: null,
      dpiY: null,
      bitDepth: bitDepth,
      bitDepthText: '8 бит/пиксель (индекс палитры)',
      compression: 'LZW (словарное сжатие без потерь)',
      extras: extras
    };
  }

  root.ImgInfo = root.ImgInfo || {};
  root.ImgInfo.gif = parseGif;
})(typeof self !== 'undefined' ? self : globalThis);
