function trim(str) {
  str = str.toString();
  var start = 0;
  var end = str.length - 1;
  while (start < str.length && str.charCodeAt(start) < 33) { ++start; }
  while (end > start && str.charCodeAt(end) < 33) { --end; }
  return str.substring(start, end + 1);
}

function rtrim(str) {
  str = str.toString();
  var end = str.length - 1;
  while (end > 0 && str.charCodeAt(end) < 33) { --end; }
  return str.substr(0, end + 1);
}

exports.trim = trim;
exports.rtrim = rtrim;