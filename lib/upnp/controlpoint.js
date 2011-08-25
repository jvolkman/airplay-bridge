var util = require('util');
var events = require('events');
var dgram = require('dgram');
var net = require('net');

var protocol = require('./protocol');
var tools = require('../tools');
var device = require('./device');

/**
 * A UPnP ControlPoint.
 *
 */
function ControlPoint(opts) {
  events.EventEmitter.call(this);
  this._broadcastAddress = '239.255.255.250';
  this._broadcastPort = 1900;
  this._broadcastTTL = 2;
  this._broadcastRepeatInterval = 15000;
  this._MX = 5;
  this._devices = {};
  if (opts !== undefined) {
    if (opts.broadcastAddress !== undefined) {
      this._broadcastAddress = opts.broadcastAddress;
    }
    if (opts.broadcastPort !== undefined) {
      this._broadcastPort = opts.broadcastPort;
    }
    if (opts.broadcastTTL !== undefined) {
      this._broadcastTTL = opts.broadcastTTL;
    }
    if (opts.broadcastRepeatInterval !== undefined) {
      this._broadcastRepeatInterval = opts.broadcastRepeatInterval;
    }
    if (opts.MX !== undefined) {
      this._MX = opts.MX;
    }
    if (this._broadcastRepeatInterval < this._MX) {
      throw 'broadcastRepeatInterval [' + this._broadcastRepeatInterval + '] should be greater than MX [' + this._MX + ']';
    }
  }
  this._devices = {};
  this._init();
}
util.inherits(ControlPoint, events.EventEmitter);

ControlPoint.prototype._init = function() {
  console.info('ControlPoint::init');
  this._multicastSocket = dgram.createSocket('udp4');
  this._localSocket = dgram.createSocket('udp4');
  this._multicastSocket.setBroadcast(1);
  this._localSocket.setBroadcast(1);
  var controlPoint = this;
  this._multicastSocket.on('message', function(buf, rinfo) {
    var input;
    try {
      input = protocol.parseMessage(buf);
    } catch (e) {
      console.warn('Error parsing message: ' + e);
    }
    if (input !== undefined) {
      // switch(input.type) {
      //   default:
          console.log('MULTI:');
          try {
            console.log(new device.DiscoveredDevice(input.parameters, input.type));
          } catch (ex) {
            console.warn(ex);
          }
          // break;
      // }
    }
  });
  this._localSocket.on('message', function(buf, rinfo) {
    var input = protocol.parseMessage(buf);
    if (input !== undefined) {
      // switch(input.type) {
      //   default:
          console.log('LOCAL:');
          try {
            console.log(new device.DiscoveredDevice(input.parameters, input.type));
          } catch (ex) {
            console.warn(ex);
          }
      //     break;
      // }
    }
  });
  this._localSocket.once('listening', function() {
    controlPoint.search();
  });
  this._multicastSocket.bind(this._broadcastPort);
  this._multicastSocket.addMembership('239.255.255.250');
  this._multicastSocket.setMulticastTTL(this._broadcastTTL);
  this._localSocket.setMulticastLoopback(false);
  this._localSocket.bind();
  this._searchInterval = setInterval(function() {
    controlPoint.search();
    controlPoint._pruneDevices();
  }, this._broadcastRepeatInterval);
};

ControlPoint.prototype.shutdown = function() {
  console.log('ControlPoint::shutdown');
  this._multicastSocket.close();
  this._multicastSocket = null;
  this._localSocket.close();
  this._localSocket = null;
  clearInterval(this._pingInterval);
};

ControlPoint.prototype.search = function(types, mx) {
  if (this._localSocket === null) {
    throw "Shutdown";
  }
  if (types === undefined) {
    types = ['ssdp:all'];
  } else if (!Array.isArray(types)) {
    types = [types];
  }
  if (mx === undefined) {
    mx = this._MX;
  }

  var controlPoint = this;
  types.map(function(type) {
    var message = protocol.createMessage('SEARCH', {
      Host: controlPoint._broadcastAddress + ':' + controlPoint._broadcastPort,
      Man: '"ssdp:discover"',
      ST: type,
      MX: mx
    });
    controlPoint._localSocket.send(message, 0, message.length, controlPoint._broadcastPort, controlPoint._broadcastAddress); 
  });
};

ControlPoint.prototype.getDevices = function() {
  var devices = this._devices;
  return Object.getOwnPropertyNames(this._devices).map(function(d) { return devices[d].device; });
};

ControlPoint.prototype.getDevice = function(id) {
  var deviceData = this._devices[id];
  if (deviceData) {
    return deviceData.device;
  }
};

ControlPoint.prototype._addOrUpdateDevice = function(device) {
  var deviceData = this._devices[device.id];
  if (deviceData !== undefined) {
    if (!device.equals(deviceData.device)) {
      this.emit('deviceRemoved', deviceData.device);
      delete this._devices[device.id];
    } else {
      deviceData.lastSeen = new Date().getTime();
      return;
    }
  }
  this._devices[device.id] = {
    device: device,
    lastSeen: new Date().getTime()
  };
  this.emit('deviceAdded', device);
};

ControlPoint.prototype._pruneDevices = function() {
  // for (var key in this._devices) {
  //   if (this._devices.hasOwnProperty(key)) {
  //     var deviceData = this._devices[key];
  //     if (deviceData.lastSeen < new Date().getTime() - SEARCH_TIMEOUT) {
  //       this.emit('deviceRemoved', deviceData.device);
  //       delete this._devices[key];
  //     }
  //   }
  // }
};

exports.ControlPoint = ControlPoint;