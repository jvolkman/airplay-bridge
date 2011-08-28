events   = require 'events'
net      = require 'net'
protocol = require './protocol'

class exports.DeviceInfo
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

class exports.DeviceConnection extends events.EventEmitter
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
      parsed = protocol.parseMessage @_buf
    catch ex
      parsed = null

    while parsed? 
      offset += parsed.bytesRead
      @emit 'message', parsed.message
      messagesReceived++
      try
        parsed = protocol.parseMessage @_buf, offset
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
    buf = protocol.createMessage command, data, @_deviceInfo.type
    @_socket.write buf
    buf.length
