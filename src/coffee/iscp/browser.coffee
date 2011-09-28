events   = require 'events'
dgram    = require 'dgram'
protocol = require './protocol'
device   = require './device'

###
 An ISCP device Browser/tracker.
###
class exports.Browser extends events.EventEmitter
  constructor: (opts) ->
    @_opts = 
      broadcastPort: 60128
      broadcastAddress: '255.255.255.255'
      pingInterval: 15000
      pingTimeout: 60000
    
    @_opts[key] = value for own key, value of opts if opts?
    
    @_devices = {}
    @_init()

  _init: () ->
    @_socket = dgram.createSocket 'udp4'
    @_socket.setBroadcast 1
    @_socket.on 'message', (buf, rinfo) =>
      try 
        input = protocol.parseMessage buf
      catch ex
        input = null
      if input?.message?.command is 'ECN'
        parts = input.message.data.split '/'
        if parts.length is 4
          @_addOrUpdateDevice new device.DeviceInfo
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
    , @_opts.pingInterval
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
    message = protocol.createMessage 'ECN', 'QSTN'
    @_socket.send message, 0, message.length, @_opts.broadcastPort, @_opts.broadcastAddress

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
      if value.lastSeen < new Date().getTime() - @_opts.pingTimeout
        @emit 'deviceRemoved', deviceData.device
        delete @_devices[key]
        pruned++
    pruned
