
$(document).on('dragover', '#dropin', function(e) {
  e.stopPropagation();
  e.preventDefault();
  e.originalEvent.dataTransfer.dropEffect = 'copy';
  return false;
});

$(document).on('drop', '#dropin', function(e) {
  clearPreview();
  e.preventDefault();
  var evt = e.originalEvent;
  if (evt.dataTransfer && evt.dataTransfer.files.length != 0) {
    var files = evt.dataTransfer.files;
    ga('send', 'event', 'chapter', 'drop', files[0].name, 1);
    if (files.length) {
      ga('send', 'event', 'chapter', 'drop', 'multi', 1);
    }
    var promises = Array.prototype.concat.apply([], files).map(function(file) {
      return readFile(file);
    });
    $.when.apply($, promises).then(function() {
      console.log(arguments);
      var chap = convertTimes(concatChapters(arguments));
      console.log(
        chap
      );
      showPreview(chap);
    }, function() {
      console.log('failed');
    });
  }
  return false;
});

function sortChapter(chap) {
  return chap.sort(function(a, b) {
    return a.time - b.time;
  });
}

function uniqueChapter(chap, warn) {
  chap = sortChapter(chap);
  var n = chap.length;
  if (n < 2) return chap;
  var removed = 0;
  for (var i = n - 2; i >= 0; --i) {
    if (Math.abs(chap[i].time - chap[i + 1].time) < 0.01) { // 10ms以下
      if (warn) {
        warn.push('チャプター' + (i + 1) + 'が時刻重複');
      }
      chap[i + 1].time = -1
      ++removed;
    }
  }
  return sortChapter(chap).slice(removed, n);
}

// chap1, chap2 must be sorted.
function concatChapters(chaps) {
  //return chaps[0]; // TODO:

  var newChap = [];
  var start = 0.0;
  for (var chapIndex = 0; chapIndex < chaps.length; ++chapIndex) {
    var chap = chaps[chapIndex];
    var lastTime = 0.0;
    for (var i = 0; i < chap.length; ++i) {
      var c = chap[i];
      c.time += start;
      lastPos = c.time;
      newChap.push(c);
    }
    start = lastPos;
  }
  return newChap;
}

function parseInt32(b, offset) {
  if (offset) {
    b = b.subarray(offset, offset + 4);
  }
  return (b[0] << 24) + (b[1] << 16) + (b[2] << 8) + b[3];
}

function parseInt16(b, offset) {
  if (offset) {
    b = b.subarray(offset, offset + 2);
  }
  return (b[0] << 8) + b[1];
}

function bcd2bin(x) {
  return 10 * (x >> 4) + (x & 0xF);
}

function parsePlaybackBCD(b, offset) {
  if (offset) {
    b = b.subarray(offset, offset + 4);
  }
  var frameRate = (b[3] & 0xC0) == 0x40 ? 25 : 29.97;
  var ms = bcd2bin(b[3] & 0x3F) / frameRate;
  return bcd2bin(b[0]) * 3600 + bcd2bin(b[1]) * 60 + bcd2bin(b[2]) + ms;
}

var buff2str = function(buff){
  var size = buff.length;
  if (size < 3) {
    return '';
  }
  var i = 0, str = '', c, code;
  if (buff[0] == 0xEF && buff[1] == 0xBB && buff[2] == 0xBF) {
    i = 3;
  }
  while(i < size){
    c = buff[i];
    if ( c < 128){
      str += String.fromCharCode(c);
      i++;
    } else if ((c ^ 0xc0) < 32){
      code = ((c ^ 0xc0) << 6) | (buff[i+1] & 63);
      str += String.fromCharCode(code);
      i += 2;
    } else {
      code = ((c & 15) << 12) | ((buff[i+1] & 63) << 6) |
        (buff[i+2] & 63);
      str += String.fromCharCode(code);
      i += 3;
    }
  }
  return str;
}

function readMPLS(first, b) {
  var headerMPLS = 'MPLS0';
  if (first.substring(0, 5) != headerMPLS) {
    return undefined;
  }
  var o = [];
  var itemStart = parseInt32(b, 8);
  var chapStart = parseInt32(b, 12);
  if (itemStart > b.length || chapStart > b.length) {
    throw 'Invalid mpls file';
  }
  var itemCount = parseInt16(b, itemStart + 6);
  var items = [];
  // Play Itemを集める
  var itemOffset = itemStart + 10;
  for (var i = 0; i < itemCount; ++i) {
  	var len = parseInt16(b, itemOffset);
    var tmp = {};
    tmp.startPTS = parseInt32(b, itemOffset + 14);
    tmp.endPTS = parseInt32(b, itemOffset + 18);
    tmp.duration = (tmp.endPTS - tmp.startPTS) / 45000.0;
    if (items.length > 0) {
      tmp.startTime = items[items.length - 1].endTime;
      tmp.endTime = tmp.startTime + tmp.duration;
    } else {
      tmp.startTime = 0.0;
      tmp.endTime = tmp.duration;
    }
    items.push(tmp);
    itemOffset += len + 2;
  }
  console.log(items);

  // Chapterを集める
  var chapLength = parseInt32(b, chapStart);
  var chapCount = (chapLength - 2) / 14;
  for (var i = 0; i < chapCount; ++i) {
    var offset = chapStart + 6 + 4 + i * 14;
    var itemNo = parseInt16(b, offset - 2);
    if (itemNo >= items.length) {
      throw 'Invalid mpls file';
    }
    var t = parseInt32(b, offset) - items[itemNo].startPTS;
    console.log(t, itemNo);
    if (t < 0) {
      throw 'Invalid Chapter PTS.';
    }
    o.push({
      time: t / 45000.0 + items[itemNo].startTime,
      title: ''
    });
  }
  var endTime = items[items.length - 1].endTime;
  if (o.length > 0 && Math.abs(o[o.length - 1].time - endTime) < 2.0) {
    o.pop(); // 最後に短いチャプターがある場合はいったん消す
  }
  o.push({
    time: endTime,
    title: 'MOVIE_END'
  });
  o.type = 'MPLS';
  return o;
}

function readIFO(first, b) {
  // DVD IFO file
  var headerIFOVTS = 'DVDVIDEO-VTS';
  if (first.substring(0, 12) != headerIFOVTS) {
    return;
  }
  var o = [];
  var offsetToPCGI = 2048 * parseInt32(b, 0x00CC);
  var aPCGI = b.subarray(offsetToPCGI);
  var numPC = parseInt16(aPCGI);
  for (var i = 0; i < numPC; ++i) {
    if (aPCGI[8 + 8 * i] & 0x80) {
      // entry PCG
      var offsetToPCG = parseInt32(aPCGI, 8 + 8 * i + 4);
      var duration = parsePlaybackBCD(aPCGI, offsetToPCG + 0x0004);
      o.push({
        time: duration,
        title: 'MOVIE_END'
      });
      var offsetToPlaybackInfo = parseInt16(aPCGI, offsetToPCG + 0x00E8);
      var offsetToPlaybackInfoNext = parseInt16(aPCGI, offsetToPCG + 0x00EA);
      var infoLength = offsetToPlaybackInfoNext - offsetToPlaybackInfo;
      var numInfo = infoLength / 24;
      var aInfo = aPCGI.subarray(offsetToPCG + offsetToPlaybackInfo);
      var startTime = 0;
      for (var j = 0; j < numInfo; ++j) {
        var chapterDuration = parsePlaybackBCD(aInfo, 24 * j + 4);
        o.push({
          time: startTime,
          title: ''
        });
        startTime += chapterDuration;
      }
      break; // TODO: first program only
    }
  }
  return o;
}

function readChapterFile(data) {
  var b = new Uint8Array(data);
  data = buff2str(b);
  var a = data.split(/[\r\n]+/);
  var n = a.length;
  var first = a[0];
  var o = [];
  var regNero1 = /^(\d+:\d+:\d+(?:\.\d+))[ \t](.*)$/;
  var regNero2_1 = /^CHAPTER\d+=(\d+:\d+:\d+(?:\.\d+))$/;
  var regNero2_2 = /^CHAPTER\d+NAME=(.+)$/;
  var regApple = /<textsample sampletime="(\d+:\d+:\d+(?:\.\d+))">([^<]+)<\/textsample>/;
  var m, m1, m2;

  var readFunc = [
    readMPLS,
    readIFO
  ];
  
  var read_o;
  for (var i = 0; i < readFunc.length; ++i) {
    read_o = (readFunc[i])(first, b);
    if (read_o) {
      break;
    }
  }

  if (read_o) {
    o = read_o;
  } else if (first.match(regNero1)) {
    for (var i = 0; i < n; ++i) {
      if (m = a[i].match(regNero1)) {
        o.push({
          time_in: m[1],
          title: m[2]
        });
      }
    }
  } else if (first.match(regNero2_1)) {
    for (var i = 0; i < n; i += 2) {
      if ((m1 = a[i].match(regNero2_1)) && (m2 = a[i+1].match(regNero2_2))) {
        o.push({
          time_in: m1[1],
          title: m2[1]
        });
      }
    }
  } else if (data.match(regApple)) {
    for (var i = 0; i < n; ++i) {
      if (m = a[i].match(regApple)) {
        o.push({
          time_in: m[1],
          title: m[2]
        });
      }
    }
  } else {
    throw 'チャプターとして認識できませんでした。';
  }

  if (o.length == 0) {
    throw 'チャプターがありませんでした。';
  }
  for (var i = 0; i < o.length; ++i) {
    if (o[i].time_in) {
      var a = o[i].time_in.split(':');
      o[i].time = 3600.0 * parseInt(a[0]) + 60.0 * parseInt(a[1]) + parseFloat(a[2]);
    }
  }
  console.log(o);
  o = uniqueChapter(o);

  // 0秒チャプターを付与
  if (o[0].time < 0.01) {
    o[0].time = 0.0;
  } else {
    o.unshift({
      time: 0,
      title: ''
    });
  }
  return o;
}

function timeFromString(time_str) {
  var a = time_str.split(':');
  return 3600.0 * parseInt(a[0]) + 60.0 * parseInt(a[1]) + parseFloat(a[2]);
}

function convertTimes(chap) {
  var i, n = chap.length;
  for (i = 0; i < n; ++i) {
    var t = chap[i].time + 0.0001;
    var h = ('0' + Math.floor(t / 3600).toFixed(0)).slice(-2);
    var m = ('0' + (Math.floor(t / 60) % 60).toFixed(0)).slice(-2);
    var s = ('0' + (Math.floor(t) % 60).toFixed(0)).slice(-2);
    var ms = ('00' + (Math.floor((t % 1) * 1000)).toFixed(0)).slice(-3);
    chap[i].time_str = h + ':' + m + ':' + s + '.' + ms;
  }
  return chap;
}

function makeOutput(chap, offset_str) {
  var out = {};
  var nero1 = [], nero2 = [], apple = [], key30 = [], key24 = [];
  var fps30 = 30000 / 1001, fps24 = 24000 / 1001;
  apple.push('<textstream version="1.1">', '<textstreamheader>', '<textsampledescription>',
             '</textsampledescription>', '</textstreamheader>');
  var c, cnt;
  var i, n = chap.length;
  if (offset_str) {
    try {
      var offset = timeFromString(offset_str);
      for (i = 0; i < n; ++i) {
        chap[i].time += offset;
      }
    } catch(e) {
    }
  }
  convertTimes(chap);
  for (i = 0; i < n; ++i) {
    c = chap[i];
    nero1.push(c.time_str + ' ' + c.title);
    if (i < 100) {
      cnt = ('0' + (i + 1).toString()).slice(-2);
    } else {
      cnt = (i + 1).toString();
    }
    nero2.push('CHAPTER' + cnt + '=' + c.time_str);
    nero2.push('CHAPTER' + cnt + 'NAME=' + c.title);
    apple.push('<textsample sampletime="' + c.time_str + '">' + c.title + '</textsample>');
    key30.push((c.time * fps30 + 1).toFixed(0));
    key24.push((c.time * fps24 + 1).toFixed(0));
  }
  apple.push('</textstream>');

  out.nero1 = nero1.join("\r\n");
  out.nero2 = nero2.join("\r\n");
  out.apple = apple.join("\r\n");
  out.key30 = key30.join("\r\n");
  out.key24 = key24.join("\r\n");
  return out;
}

function setView(chap, files, offset_str) {
  var dropTargets = ['nero1', 'nero2', 'apple', 'key30', 'key24'];
  var out = makeOutput(chap, offset_str);
  console.log(out.nero1);
  for (var i = 0; i < dropTargets.length; ++i) {
    var t = dropTargets[i];
    $('#get_' + t)
      .removeClass('disabled')
      .attr('target', '_blank')
      .attr('draggable', true)
      .attr('download', file.name + '_' + t + '.txt')
      .attr('href', 'data:text/plain;base64,' + encodeURIComponent(Base64.encode(out[t])));
  }
  $('#input')
    .text(file.name + 'を読み込みました。')
    .removeClass('alert-danger')
    .addClass('alert-success');
}

function setViewError(file, e) {
  var dropTargets = ['nero1', 'nero2', 'apple'];
  // disable get_s
  for (var i = 0; i < dropTargets.length; ++i) {
    var t = dropTargets[i];
    $('#get_' + t).addClass('disabled');
  }
  // show error
  $('#input')
    .text(file.name + 'の処理でエラーが発生しました。' + "\r\n" + e.toString())
    .removeClass('alert-success')
    .addClass('alert-danger');
  ga('send', 'exception', {
    'exDescription': 'ProcessingError',
    'exFatal': false
  });
}

function clearPreview() {
  $('#preview_description').show(false);
  $('#preview_table').hide(false);
}

function showPreview(chap) {
  var el = $('#preview_template');
  var pel = el.parent();
  var template = el.html();
  $('.inserted').remove();
  $('#preview_description').hide(false);
  $('#preview_table').show(false)

  for (var i = 0; i < chap.length; ++i) {
    var c = chap[i];
    var str = template.replace('{{no}}', (i + 1) + '.')
        .replace('{{time}}', c.time_str)
        .replace('{{title}}', c.title);
    pel.append('<tr class="inserted">' + str + '</tr>');
  }
}

function readFile(file, startTime) {
  var d = new $.Deferred;
  var reader = new FileReader();
  reader.onload = function(event) {
    // ファイルのデータが入ったStringを取得
    var data = event.target.result;
    var size = data.length;

    try {
      var chap = readChapterFile(data);
      var offset_str = $('#time_offset').val();
      setView(chap, file, offset_str);
      d.resolve(chap);
    } catch(e) {
      setViewError(file, e);
      d.reject();
      throw e;
    }
  };

  reader.onerror = function(error) {
    $('#result').text('読み込み失敗');
    ga('send', 'exception', {
      'exDescription': 'ReadError',
      'exFatal': false
    });
    d.reject();
  };

  var limit = 128 * 1024;
  if (file.slice) {
    var blob = file.slice(0, limit);
  } else if (file.webkitSlice) {
    var blob = file.webkitSlice(0, limit);
  } else if (file.mozSlice) {
    var blob = file.mozSlice(0, limit);
  }
  //reader.readAsText(blob);
  reader.readAsArrayBuffer(blob);
  return d.promise();
}

$('#get_nero1,#get_nero2,#get_apple,#get_key30,#get_key24').on('dragstart', function(event) {
  var el = $(this);
  var fileName = el.attr('download');
  var content = el.attr('href');
  event.originalEvent.dataTransfer.setData('DownloadURL', 'text/plain:' + fileName + ':' + content);
  ga('send', 'event', 'drag', this.id, '', 1);
}).on('click', function(event) {
  ga('send', 'event', 'download', this.id, '', 1);
});

$('#select_file_link').on('click', function(e) {
  e.preventDefault();
  $('#select_file').click();
});

$('#select_file').on('change', function() {
  readFile(this.files[0]);
});
