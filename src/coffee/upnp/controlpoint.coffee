util = require 'util'
events = require 'events'
dgram = require 'dgram'
net = require 'net'

protocol = require './protocol'
device = require './device'
tools = require '../tools'

###
 A UPnP ControlPoint.
###
class ControlPoint extends events.EventEmitter
  constructor: (opts) ->
    @_devices = {};
    @_broadcastAddress = opts?.broadcastAddress ? '239.255.255.250' 
    @_broadcastPort = opts?.broadcastPort ? 1900
    @_broadcastTTL = opts?.broadcastTTL ? 2
    @_broadcastRepeatInterval = opts?.broadcastRepeatInterval ? 15000
    @_MX = opts?.MX ? 5

    throw "broadcastRepeatInterval [#{@_broadcastRepeatInterval}] should be greater than MX [#{@_MX}]" if @_broadcastRepeatInterval < @_MX

    @_init()

  _init: () ->
    console.log 'ControlPoint::init'
    @_multicastSocket = dgram.createSocket 'udp4'
    @_localSocket = dgram.createSocket 'udp4'
    @_multicastSocket.setBroadcast 1
    @_localSocket.setBroadcast 1

    @_multicastSocket.on 'message', (buf, rinfo) =>
      try
        input = protocol.parseMessage(buf);
      catch e
        console.warn "Error parsing message: #{e}"

      if input?
        console.log 'MULTI:'
        try
          console.log new device.DiscoveredDevice(input.parameters, input.type)
        catch ex
          console.warn ex
          
    @_localSocket.on 'message', (buf, rinfo) =>
      try
        input = protocol.parseMessage(buf);
      catch e
        console.warn "Error parsing message: #{e}"

      if input?
        console.log 'LOCAL:'
        try
          console.log new device.DiscoveredDevice(input.parameters, input.type)
        catch ex
          console.warn ex

    @_localSocket.once 'listening', () => @search()

    @_multicastSocket.bind @_broadcastPort
    @_multicastSocket.addMembership @_broadcastAddress
    @_multicastSocket.setMulticastTTL @_broadcastTTL
    @_localSocket.setMulticastLoopback false
    @_localSocket.bind()
    @_searchInterval = setInterval () =>
      @search()
      @_pruneDevices()
    , @_broadcastRepeatInterval
    true

  shutdown: () ->
    console.log 'ControlPoint::shutdown'
    return false if @_multicastSocket is null
    @_multicastSocket.close()
    @_multicastSocket = null
    @_localSocket.close()
    @_localSocket = null
    clearInterval @_pingInterval
    true
    
  search: (types, mx) ->
    throw 'ControlPoint is shutdown' unless @_localSocket?

    types = [types ? 'ssdp:all'] unless Array.isArray types
    mx ?= @_MX

    for type in types
      message = protocol.createMessage 'SEARCH',
        Host: @_broadcastAddress + ':' + @_broadcastPort
        Man: '"ssdp:discover"'
        ST: type
        MX: mx

      @_localSocket.send message, 0, message.length, @_broadcastPort, @_broadcastAddress 
    true
    
  getDevices: () -> value.device for own key, value of @_devices
  getDevice: (id) -> @_devices[id]?.device

  _addOrUpdateDevice: (device) ->
    deviceData = @_devices[device.id]
    updated = false
    if deviceData?
      if not device.equals deviceData.device
        @emit 'deviceRemoved', deviceData.device
        delete @_devices[device.id]
        updated = true
      else
        deviceData.lastSeen = new Date().getTime()
        return true

    @_devices[device.id] =
      device: device
      lastSeen: new Date().getTime()
    @emit 'deviceAdded', device
    updated

  _pruneDevices: () ->
    for own key, value of @_devices
      if value.lastSeen < new Date().getTime() - SEARCH_TIMEOUT
        @emit 'deviceRemoved', value.device
        @_devices[key]

exports.ControlPoint = ControlPoint