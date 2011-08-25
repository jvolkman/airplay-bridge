var tools = require('../tools');

function parseMessage(buf) {
  function nextNewLine(buf, start) {
    for (; start < buf.length - 1; start++) {
      if (buf[start] === 13 && buf[start + 1] === 10) { // CR, LF
        return start;
      } 
    }
    return -1;
  }

  // First we grab the first line.
  var fromPos = 0;
  var toPos = nextNewLine(buf, fromPos);
  if (toPos === -1) {
    throw 'Invalid message: No newlines found.';
  }
  var firstLine = buf.toString('ascii', fromPos, toPos);
  var type;
  switch(firstLine) {
    case 'NOTIFY * HTTP/1.1':
      type = 'NOTIFY';
      break;
    case 'M-SEARCH * HTTP/1.1':
      type = 'SEARCH';
      break;
    case 'HTTP/1.1 200 OK':
      type = 'RESPONSE';
      break;
    default:
      throw 'Invalid message: Unknown message type. [' + firstLine + ']';
  }
  // Now we parse headers.
  var headers = {};
  var lastHeader;
  fromPos = toPos + 2; // account for \r\n
  toPos = nextNewLine(buf, fromPos);
  while (toPos !== -1) {
    var headerString = buf.toString('ascii', fromPos, toPos);
    if (headerString === '') { // End of the message
      return {
        type: type,
        parameters: headers
      };
    } else if (headerString.charCodeAt(0) === 32 || headerString.charCodeAt === 9) { // Starts with a space or tab: continuation
      if (lastHeader === undefined) {
        throw 'Invalid message: Continued header value without starting header. [' + headerString + ']';
      }
      if (Array.isArray(headers[lastHeader])) {
        var a = headers[lastHeader];
        a[a.length - 1] = a[a.length - 1] + ' ' + tools.trim(headerString);
      } else {
        headers[lastHeader] = headers[lastHeader] + ' ' + tools.trim(headerString);
      }
    } else {
      var colonPos = headerString.indexOf(':');
      if (colonPos === -1) {
        throw 'Invalid message: No colon found on header line. [' + headerString + ']';
      }
      var headerName = tools.rtrim(headerString.slice(0, colonPos)).toLowerCase();
      var headerValue = tools.trim(headerString.slice(colonPos + 1));
      // Multiple headers with this name -- create an array
      if (headers.hasOwnProperty(headerName)) {
        if (Array.isArray(headers[headerName])) {
          headers[headerName].push(headerValue);
        } else {
          headers[headerName] = [ headers[headerName], headerValue ];
        }
      } else {
        headers[headerName] = headerValue;
      }
      lastHeader = headerName;
    }
    fromPos = toPos + 2; // account for \r\n
    toPos = nextNewLine(buf, fromPos);
  }
}

function createMessage(type, parameters) {
  // calculate buffer length
  var firstLine;
  var param, key;
  switch(type) {
    case 'NOTIFY':
      firstLine = 'NOTIFY * HTTP/1.1';
      break;
    case 'SEARCH':
      firstLine = 'M-SEARCH * HTTP/1.1';
      break;
    case 'RESPONSE':
      firstLine = 'HTTP/1.1 200 OK';
      break;
    default:
      throw 'Invalid message type. [' + type + ']';
  }
  var len = firstLine.length + 2;
  for (key in parameters) {
    if (parameters.hasOwnProperty(key)) {
      param = parameters[key];
      if (param === null || param === undefined) {
        throw 'Parameter value is null or undefined. [' + key + ']';
      }
      len += key.length + param.toString().length + 4;
    }
  }
  len += 2;
  
  var buf = new Buffer(len);
  var pos = 0;
  pos += buf.write(firstLine, pos, 'ascii');
  pos += buf.write('\r\n', pos, 'ascii');
  for (key in parameters) {
    if (parameters.hasOwnProperty(key)) {
      param = parameters[key];
      pos += buf.write(key, pos, 'ascii');
      pos += buf.write(': ', pos, 'ascii');
      pos += buf.write(param.toString(), pos, 'ascii');
      pos += buf.write('\r\n', pos, 'ascii');
    }
  }
  buf.write('\r\n', pos, 2, 'ascii');
  return buf;
}

/** 
 * According to the spec (Tables 1-1, 1-2 and 1-3 in the 1.1 spec), the usn will be in one of
 * the following formats:
 *   uuid:device-UUID
 *   uuid:device-UUID::upnp:rootdevice
 *   uuid:device-UUID::urn:schemas-upnp-org:device:deviceType:ver
 *   uuid:device-UUID::urn:domain-name:device:deviceType:ver
 *   uuid:device-UUID::urn:schemas-upnp-org:service:serviceType:ver
 *   uuid:device-UUID::urn:domain-name:service:serviceType:ver
 *
 * The device-UUID in 1.1 is described as the following:
 *
 *   UUIDs are 128 bit numbers that MUST be formatted as specified by the following grammar (taken from [1]): 
 *     UUID = 4 * <hexOctet> "-" 2 * <hexOctet> "-" 2 * <hexOctet> "-" 2 * <hexOctet> "-" 6 * <hexOctet> 
 *     hexOctet = <hexDigit> <hexDigit> 
 *     hexDigit = "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"a"|"b"|"c"|"d"|"e"|"f"|"A"|"B"|"C"|"D"|"E"|"F"
 * 
 * For which we could use
 * var uuidMatcher1_1 = /^(uuid:[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})(?:::.*)?$/;
 */
var uuidMatcher1_0 = /^(uuid:.*?)(?:::.*)?$/;
function extractDeviceIdFromUSN(usn) {
  var results = uuidMatcher1_0.exec(usn);
  if (results) {
    return results[1].toLowerCase();
  }
}

/**
 * Parses a DATE field, rfc1123-date, as defined by the spec. Returns the date in milliseconds since epoch.
 */
function parseDate(date) {
  return Date.parse(date);
}

/**
 * Parses the cache control header. Returns the 'max-age' value in milliseconds.
 */
var maxAgeMatcher = /max-age\s*=\s*([0-9]+)/;
function parseCacheControl(cacheControl) {
  var results = maxAgeMatcher.exec(cacheControl);
  if (results) {
    return parseInt(results[1], 10) * 1000;
  }
}

exports.parseMessage = parseMessage;
exports.createMessage = createMessage;
exports.extractDeviceIdFromUSN = extractDeviceIdFromUSN;
exports.parseDate = parseDate;
exports.parseCacheControl = parseCacheControl;
