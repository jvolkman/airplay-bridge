tools  = require '../tools' 

### Some protocol definitions ###
ISCP_HELLO = 'ISCP'
ISCP_HEADER_SIZE = 4 + # 'ISCP' length
                   4 + # header length
                   4 + # data length 
                   1 + # version
                   3   # reserved
ISCP_VERSION = 1
ISCP_HELLO_OFFSET = 0
ISCP_HEADER_SIZE_OFFSET = 4
ISCP_DATA_SIZE_OFFSET = 8
ISCP_VERSION_OFFSET = 12
ISCP_DATA_OFFSET = 16
ISCP_DESTINATION_TYPE_RECEIVER = '1'
ISCP_DESTINATION_TYPE_ANY = 'x'

### Message header template ###
ISCP_HEADER_TEMPLATE = new Buffer(ISCP_HEADER_SIZE)
ISCP_HEADER_TEMPLATE.fill 0
ISCP_HEADER_TEMPLATE.write ISCP_HELLO, ISCP_HELLO_OFFSET
ISCP_HEADER_TEMPLATE.writeUInt32 ISCP_HEADER_SIZE, ISCP_HEADER_SIZE_OFFSET, true
ISCP_HEADER_TEMPLATE.writeUInt32 0, ISCP_DATA_SIZE_OFFSET, true
ISCP_HEADER_TEMPLATE.writeUInt8 ISCP_VERSION, ISCP_VERSION_OFFSET, true

### Utility functions ###
exports.descriptiveTypeString = (type) ->
  switch type
    when ISCP_DESTINATION_TYPE_RECEIVER then 'Receiver'
    when ISCP_DESTINATION_TYPE_ANY then 'Any'
    else 'Unknown'

exports.createMessage = (command, data, destinationType) ->
  destinationType ?= ISCP_DESTINATION_TYPE_ANY
  content = "!#{destinationType + command + data}\n"
  buf = new Buffer(ISCP_HEADER_SIZE + content.length)
  ISCP_HEADER_TEMPLATE.copy buf
  buf.writeUInt32 content.length, ISCP_DATA_SIZE_OFFSET, true
  buf.write content, ISCP_DATA_OFFSET, 'UTF-8'
  buf
  
exports.parseMessage = (buf, offset) ->
  offset ?= 0
  throw 'buf is not a Buffer' unless Buffer.isBuffer buf
  throw "Message is too short: #{buf.length - offset} < #{ISCP_HELLO.length}" if buf.length - offset < ISCP_HELLO.length

  hello = buf.toString 'ascii', offset, offset + ISCP_HELLO.length
  throw "Invalid hello: #{hello}" if hello isnt ISCP_HELLO

  headerSize = buf.readUInt32 offset + ISCP_HEADER_SIZE_OFFSET, true
  dataSize = buf.readUInt32 offset + ISCP_DATA_SIZE_OFFSET, true

  # Messages always start with '!', followed by 1 character representing the target type
  throw "First character isn't '!'" if buf[offset + headerSize] isnt 33

  destinationType = String.fromCharCode buf[offset + headerSize + 1]
  command = buf.toString 'ascii', offset + headerSize + 2, offset + headerSize + 5 # 3 character command
  data = tools.rtrim buf.toString 'UTF-8', offset + headerSize + 5, offset + headerSize + dataSize

  # Return structure
  bytesRead: headerSize + dataSize
  message:
    command: command
    data: data
    destinationType: destinationType
