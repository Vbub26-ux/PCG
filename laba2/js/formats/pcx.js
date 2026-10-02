(function (root) {
  'use strict';

  function rd8(bytes, off) {
    return (off >= 0 && off < bytes.length) ? bytes[off] : null;
  }

  function rdU16le(bytes, off) {
    if (off < 0 || off + 1 >= bytes.length) return null;
    return bytes[off] | (bytes[off + 1] << 8);
  }

  function plural(n, one, few, many) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  function parsePcx(bytes, fileSize, tailBytes) {
    if (bytes.length < 128) {
      throw new Error('Заголовок PCX обрезан: требуется 128 байт, доступно ' + bytes.length);
    }

    var manufacturer = rd8(bytes, 0);
    if (manufacturer !== 10) {
      throw new Error('Файл не является PCX');
    }

    var version = rd8(bytes, 1);
    var versionNames = {
      0: 'версия 2.5 (без палитры, EGA)',
      1: 'не документирована',
      2: 'версия 2.8 с палитрой (EGA)',
      3: 'версия 2.8 без палитры',
      4: 'Paintbrush for Windows',
      5: 'версия 3.0 и выше (VGA)'
    };
    var versionName = versionNames[version] || 'неизвестная версия';

    var encoding = rd8(bytes, 2);

    var bitsPerPixel = rd8(bytes, 3);

    var xmin = rdU16le(bytes, 4);
    var ymin = rdU16le(bytes, 6);
    var xmax = rdU16le(bytes, 8);
    var ymax = rdU16le(bytes, 10);
    if (xmin === null || ymin === null || xmax === null || ymax === null) {
      throw new Error('Заголовок PCX обрезан: не хватает координат растра');
    }
    var width = xmax - xmin + 1;
    var height = ymax - ymin + 1;
    if (width <= 0 || height <= 0) {
      throw new Error('Некорректные размеры PCX: xmax должен быть не меньше xmin, ymax — не меньше ymin');
    }

    var hDPI = rdU16le(bytes, 12);
    var vDPI = rdU16le(bytes, 14);
    if (hDPI === null || vDPI === null) {
      throw new Error('Заголовок PCX обрезан: не хватает данных о разрешении');
    }

    var nPlanes = rd8(bytes, 65);

    var bytesPerLine = rdU16le(bytes, 66);

    var paletteType = rdU16le(bytes, 68);

    if (nPlanes === null || bytesPerLine === null || paletteType === null) {
      throw new Error('Заголовок PCX обрезан: не хватает данных о плоскостях и палитре');
    }

    var bitDepth = bitsPerPixel * nPlanes;
    var bitDepthText = nPlanes > 1
      ? bitsPerPixel + ' бит × ' + nPlanes + ' ' + plural(nPlanes, 'плоскость', 'плоскости', 'плоскостей')
      : bitsPerPixel + ' бит/пиксель';

    var compression;
    if (encoding === 1) compression = 'RLE (кодирование длин серий)';
    else if (encoding === 0) compression = 'без сжатия';
    else compression = 'неизвестный метод (encoding=' + encoding + ')';

    var extras = [];

    extras.push({
      name: 'Версия PCX',
      value: version + ' — ' + versionName,
      description: 'Версия формата из байта version заголовка (offset 1): определяет возможности файла — наличие 256-цветной VGA-палитры (версии 5 и выше), 16-цветной EGA-палитры (версия 2) и происхождение файла (Paintbrush for Windows — версия 4).'
    });

    extras.push({
      name: 'Число плоскостей',
      value: nPlanes,
      description: 'Число цветовых плоскостей из байта nPlanes заголовка (offset 65): 1 — индексный цвет (палитра), 3 — RGB (по плоскости на канал), 4 — RGB + интенсивность; полная глубина цвета = bitsPerPixel × nPlanes.'
    });

    extras.push({
      name: 'Байт на строку развёртки (bytesPerLine)',
      value: bytesPerLine + ' ' + plural(bytesPerLine, 'байт', 'байта', 'байт') +
        ' × ' + nPlanes + ' ' + plural(nPlanes, 'плоскость', 'плоскости', 'плоскостей'),
      description: 'Поле bytesPerLine заголовка (offsets 66–67, u16 little-endian): сколько байт занимает одна строка растра одной плоскости; обычно больше ширины в байтах из-за выравнивания до чётной границы, и по нему декодер RLE находит начало следующей строки.'
    });

    extras.push({
      name: 'Тип палитры',
      value: paletteType === 2 ? '2 — градации серого' : (paletteType === 1 ? '1 — цветная' : String(paletteType)),
      description: 'Поле paletteType заголовка (offsets 68–69, u16 little-endian): 1 — цветное изображение, 2 — монохромное в градациях серого; значение берётся из слова paletteType.'
    });

    if (bitsPerPixel === 8 && nPlanes === 1 && version >= 5 &&
        tailBytes && tailBytes.length >= 769 &&
        tailBytes[tailBytes.length - 769] === 0x0C) {
      extras.push({
        name: 'Число цветов палитры',
        value: '256 (VGA-палитра в конце файла)',
        description: 'У 8-битных PCX версия ≥5 палитра из 256 цветов (768 байт RGB) лежит в конце файла: за 769 байт до конца расположен байт-идентификатор 0x0C; найден в tailBytes — последних 1024 байтах файла.'
      });
    }

    extras.push({
      name: 'Палитра EGA (16 цветов)',
      value: '16 цветов × RGB в 48 байтах заголовка',
      description: 'Поля EGA palette заголовка (offsets 16–63): 16 цветов × 3 байта RGB, используются 16-цветными EGA/VGA-изображениями (версии 2 и выше); для 8-битных файлов актуальна VGA-палитра из конца файла.'
    });

    return {
      format: 'PCX',
      width: width,
      height: height,
      dpiX: hDPI,
      dpiY: vDPI,
      bitDepth: bitDepth,
      bitDepthText: bitDepthText,
      compression: compression,
      extras: extras
    };
  }

  root.ImgInfo = root.ImgInfo || {};
  root.ImgInfo.pcx = parsePcx;
})(typeof self !== 'undefined' ? self : globalThis);
