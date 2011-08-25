util   = require 'util'
events = require 'events'
dgram  = require 'dgram'
net    = require 'net'
tools  = require './tools' 

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
descriptiveTypeString = (type) ->
  switch type
    when ISCP_DESTINATION_TYPE_RECEIVER then 'Receiver'
    when ISCP_DESTINATION_TYPE_ANY then 'Any'
    else 'Unknown'

createMessage = (command, data, destinationType) ->
  destinationType ?= ISCP_DESTINATION_TYPE_ANY
  content = "!#{destinationType + command + data}\n"
  buf = new Buffer(ISCP_HEADER_SIZE + content.length)
  ISCP_HEADER_TEMPLATE.copy buf
  buf.writeUInt32 content.length, ISCP_DATA_SIZE_OFFSET, true
  buf.write content, ISCP_DATA_OFFSET, 'UTF-8'
  buf
  
parseMessage = (buf, offset) ->
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

class DeviceInfo
  constructor: ({@address, @model, @iscpPort, @classifier, @type, @id}) ->
  equals: (other) ->
    if other.constructor is DeviceInfo
      @address is other.address and
      @model is other.model and
      @iscpPort is other.iscpPort and
      @classifier is other.classifier and
      @type is other.type and
      @id is other.id
    else false

class DeviceConnection extends events.EventEmitter
  constructor: (@_deviceInfo) ->
    @_socket = new net.Socket
    @_socket.setKeepAlive true
    
    @_socket.on 'connect', () =>
      @emit 'connect'
    @_socket.on 'data', (data) =>
      @_receiveData data
    @_socket.on 'end', () ->
      @close()
    @_socket.on 'timeout', () ->
      @close()
    @_socket.on 'close', (had_error) =>
      @emit 'close', had_error
    @_socket.connect _deviceInfo.iscpPort, _deviceInfo.address
    return

  _receiveData: (input) ->
    messagesReceived = 0
    if @_buf?
      newBuf = new Buffer(@_buf.length + input.length)
      @_buf.copy newBuf, 0, 0
      input.copy newBuf, @_buf.length, 0
      @_buf = newBuf
    else
      @_buf = input

    offset = 0
    try
      parsed = parseMessage @_buf
    catch ex
      parsed = null

    while parsed? 
      offset += parsed.bytesRead
      @emit 'message', parsed.message
      messagedReceived++
      try
        parsed = parseMessage @_buf, offset
      catch ex
        parsed = null

    if offset > 0
      if @_buf.length > offset
        @_buf = @_buf.slice offset
      else
        delete @_buf;
    messagesReceived
    
  send: (command, data) ->
    data ?= ''
    buf = createMessage command, data, @_deviceInfo.type
    @_socket.write buf
    buf.length

###
 An ISCP device Browser/tracker.
###
PING_INTERVAL = 15000 # 15 seconds.
PING_TIMEOUT  = 60000 # 60 seconds.
class Browser extends events.EventEmitter
  constructor: (opts) ->
    @_broadcastPort = opts?.broadcastPort? or 60128
    @_devices = {}
    @_init()

  _init: () ->
    @_socket = dgram.createSocket 'udp4'
    @_socket.setBroadcast 1
    @_socket.on 'message', (buf, rinfo) =>
      try 
        input = parseMessage buf
      catch ex
        input = null
      if input?.message?.command is 'ECN'
        parts = input.message.data.split '/'
        if parts.length is 4
          @_addOrUpdateDevice new DeviceInfo
            address: rinfo.address
            model: parts[0]
            iscpPort: parseInt(parts[1], 10)
            classifier: parts[2]
            type: input.message.destinationType
            id: parts[3]

    @_socket.once 'listening', () => @ping()
    @_socket.bind()
    @_pingInterval = setInterval () =>
      @ping()
      @_pruneDevices()
    , PING_INTERVAL
    true

  shutdown: () ->
    if @_socket?
      @_socket.close()
      delete @_socket
      clearInterval @_pingInterval
      delete @_pingInterval
      true
    else false

  ping: () ->
    message = createMessage 'ECN', 'QSTN'
    @_socket.send message, 0, message.length, @_broadcastPort, '255.255.255.255'

  getDevices: () -> value.device for own key, value of @_devices

  getDevice: (id) -> @_devices[id]?.device

  _addOrUpdateDevice: (device) ->
    deviceData = @_devices[device.id]
    if deviceData?
      if !device.equals deviceData.device
        updated = true
        @emit 'deviceRemoved', deviceData.device
        delete @_devices[device.id]
      else
        deviceData.lastSeen = new Date().getTime()
        return true

    @_devices[device.id] = 
      device: device
      lastSeen: new Date().getTime()

    @emit 'deviceAdded', device
    updated?

  _pruneDevices: () ->
    pruned = 0
    for own key, value of @_devices
      if value.lastSeen < new Date().getTime() - PING_TIMEOUT
        @emit 'deviceRemoved', deviceData.device
        delete @_devices[key]
        pruned++
    pruned

exports.Browser = Browser
exports.DeviceConnection = DeviceConnection