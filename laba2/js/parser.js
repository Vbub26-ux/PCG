(function (root) {
  'use strict';

  var ImgInfo = root.ImgInfo = root.ImgInfo || {};

  ImgInfo.extensions = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    jfif: 'jpeg',
    gif: 'gif',
    tif: 'tiff',
    tiff: 'tiff',
    bmp: 'bmp',
    dib: 'bmp',
    png: 'png',
    pcx: 'pcx'
  };

  ImgInfo.sniff = function (bytes) {
    if (!bytes || bytes.length < 2) {
      return null;
    }

    var b0 = bytes[0];
    var b1 = bytes[1];

    if (b0 === 0xFF && b1 === 0xD8) {
      return 'jpeg';
    }

    if (bytes.length >= 4 &&
        b0 === 0x47 && b1 === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'gif';
    }

    if (bytes.length >= 4 &&
        ((b0 === 0x49 && b1 === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) ||
         (b0 === 0x4D && b1 === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A))) {
      return 'tiff';
    }

    if (b0 === 0x42 && b1 === 0x4D) {
      return 'bmp';
    }

    if (bytes.length >= 4 &&
        b0 === 0x89 && b1 === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return 'png';
    }

    if (bytes.length >= 128 &&
        b0 === 0x0A && b1 <= 5 && bytes[65] < 10) {
      return 'pcx';
    }

    return null;
  };

  ImgInfo.parse = function (bytes, ext, fileSize, tailBytes) {
    var key = ImgInfo.sniff(bytes);

    if (!key) {
      key = ImgInfo.extensions[String(ext || '').toLowerCase().replace(/^\./, '')];
    }

    if (!key) {
      throw 'Формат файла не поддерживается';
    }

    if (typeof ImgInfo[key] !== 'function') {
      throw 'Парсер формата «' + key + '» не подключён (ожидается файл js/formats/' + key + '.js)';
    }

    if (key === 'pcx') {
      return ImgInfo[key](bytes, fileSize, tailBytes);
    }

    return ImgInfo[key](bytes, fileSize);
  };
})(typeof self !== 'undefined' ? self : globalThis);
