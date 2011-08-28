tools = require '../tools'

nextNewLine = (buf, start) ->
  for i in [start...buf.length - 1]
    return i if buf[i] is 13 and buf[i + 1] is 10 # CR, LF
  -1;

exports.parseMessage = (buf) ->
  # First we grab the first line.
  fromPos = 0
  toPos = nextNewLine buf, fromPos
  throw 'Invalid message: No newlines found.' if toPos is -1

  firstLine = buf.toString 'ascii', fromPos, toPos

  type = switch firstLine
    when 'NOTIFY * HTTP/1.1' then 'NOTIFY'
    when 'M-SEARCH * HTTP/1.1' then 'SEARCH'
    when 'HTTP/1.1 200 OK' then 'RESPONSE'
    else throw "Invalid message: Unknown message type. [#{firstLine}]"

  # Now we parse headers.
  headers = {}
  fromPos = toPos + 2 # account for \r\n
  toPos = nextNewLine buf, fromPos
  while toPos isnt -1
    headerString = buf.toString 'ascii', fromPos, toPos

    if headerString is '' # End of the message
      return {
        type: type
        parameters: headers
      }
    else if headerString.charCodeAt(0) is 32 or headerString.charCodeAt(0) is 9 # Starts with a space or tab: continuation
      throw "Invalid message: Continued header value without starting header. [#{headerString}]" unless lastHeader?
      if Array.isArray headers[lastHeader]
        a = headers[lastHeader]
        a[a.length - 1] = a[a.length - 1] + ' ' + tools.trim headerString
      else 
        headers[lastHeader] = headers[lastHeader] + ' ' + tools.trim headerString
    else
      colonPos = headerString.indexOf ':'
      throw "Invalid message: No colon found on header line. [#{headerString}]" if colonPos is -1
      headerName = tools.rtrim(headerString.slice 0, colonPos).toLowerCase()
      headerValue = tools.trim headerString.slice colonPos + 1

      # Multiple headers with this name -- create an array
      if headers.hasOwnProperty headerName
        if Array.isArray headers[headerName]
          headers[headerName].push headerValue
        else
          headers[headerName] = [ headers[headerName], headerValue ]
      else
        headers[headerName] = headerValue

      lastHeader = headerName;

    fromPos = toPos + 2 # account for \r\n
    toPos = nextNewLine buf, fromPos

exports.createMessage = (type, parameters) ->
  # calculate buffer length
  firstLine = switch type
    when 'NOTIFY' then 'NOTIFY * HTTP/1.1'
    when 'SEARCH' then 'M-SEARCH * HTTP/1.1'
    when 'RESPONSE' then 'HTTP/1.1 200 OK'
    else throw "Invalid message type. [#{type}]"

  len = firstLine.length + 2
  for own key, param of parameters
    throw "Parameter value is null or undefined. [#{key}]" unless param?
    len += key.length + param.toString().length + 4

  len += 2
  
  buf = new Buffer(len)
  pos = 0
  pos += buf.write firstLine, pos, 'ascii' 
  pos += buf.write '\r\n', pos, 'ascii'
  for own key, param of parameters
    pos += buf.write key, pos, 'ascii'
    pos += buf.write ': ', pos, 'ascii'
    pos += buf.write param.toString(), pos, 'ascii'
    pos += buf.write '\r\n', pos, 'ascii'

  buf.write('\r\n', pos, 2, 'ascii');
  return buf;

###
# According to the spec (Tables 1-1, 1-2 and 1-3 in the 1.1 spec), the usn will be in one of
# the following formats:
#   uuid:device-UUID
#   uuid:device-UUID::upnp:rootdevice
#   uuid:device-UUID::urn:schemas-upnp-org:device:deviceType:ver
#   uuid:device-UUID::urn:domain-name:device:deviceType:ver
#   uuid:device-UUID::urn:schemas-upnp-org:service:serviceType:ver
#   uuid:device-UUID::urn:domain-name:service:serviceType:ver
# 
# The device-UUID in 1.1 is described as the following:
#   UUIDs are 128 bit numbers that MUST be formatted as specified by the following grammar (taken from [1]): 
#     UUID = 4 * <hexOctet> "-" 2 * <hexOctet> "-" 2 * <hexOctet> "-" 2 * <hexOctet> "-" 6 * <hexOctet> 
#     hexOctet = <hexDigit> <hexDigit> 
#     hexDigit = "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"a"|"b"|"c"|"d"|"e"|"f"|"A"|"B"|"C"|"D"|"E"|"F"
# 
# For which we could use
#   var uuidMatcher1_1 = /^(uuid:[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})(?:::.*)?$/;
###
uuidMatcher1_0 = /^(uuid:.*?)(?:::.*)?$/
exports.extractDeviceIdFromUSN = (usn) ->
  results = uuidMatcher1_0.exec usn
  results[1].toLowerCase() if results?

###
# Parses a DATE field, rfc1123-date, as defined by the spec. Returns the date in milliseconds since epoch.
###
exports.parseDate = (date) -> Date.parse date

###
# Parses the cache control header. Returns the 'max-age' value in milliseconds.
###
maxAgeMatcher = /max-age\s*=\s*([0-9]+)/
exports.parseCacheControl = (cacheControl) ->
  results = maxAgeMatcher.exec cacheControl
  parseInt(results[1], 10) * 1000 if results?
