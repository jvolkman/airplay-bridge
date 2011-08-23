var util = require('util');
var events = require('events');
var dgram = require('dgram');
var net = require('net');
var tools = require('./tools');

/* Some protocol definitions */
var ISCP_HELLO = 'ISCP';
var ISCP_HEADER_SIZE = 4 + // 'ISCP' length
                       4 + // header length
                       4 + // data length 
                       1 + // version
                       3;  // reserved
var ISCP_VERSION = 1;
var ISCP_HELLO_OFFSET = 0;
var ISCP_HEADER_SIZE_OFFSET = 4;
var ISCP_DATA_SIZE_OFFSET = 8;
var ISCP_VERSION_OFFSET = 12;
var ISCP_DATA_OFFSET = 16;
var ISCP_DESTINATION_TYPE_RECEIVER = '1';
var ISCP_DESTINATION_TYPE_ANY = 'x';

/* Message header templat */
var ISCP_HEADER_TEMPLATE = new Buffer(ISCP_HEADER_SIZE);
ISCP_HEADER_TEMPLATE.fill(0);
ISCP_HEADER_TEMPLATE.write(ISCP_HELLO, ISCP_HELLO_OFFSET);
ISCP_HEADER_TEMPLATE.writeUInt32(ISCP_HEADER_SIZE, ISCP_HEADER_SIZE_OFFSET, true);
ISCP_HEADER_TEMPLATE.writeUInt32(0, ISCP_DATA_SIZE_OFFSET, true);
ISCP_HEADER_TEMPLATE.writeUInt8(ISCP_VERSION, ISCP_VERSION_OFFSET, true);

/* Utility functions */
function descriptiveTypeString(type) {
  switch(type) {
    case ISCP_DESTINATION_TYPE_RECEIVER:
      return "Receiver";
    case ISCP_DESTINATION_TYPE_ANY:
      return "Any";
    default:
      return "Unknown";
  }
}

function createMessage(command, data, destinationType) {
  if (destinationType === undefined) {
    destinationType = ISCP_DESTINATION_TYPE_ANY;
  }
  var content = '!' + destinationType + command + data + "\n";
  var buf = new Buffer(ISCP_HEADER_SIZE + content.length);
  ISCP_HEADER_TEMPLATE.copy(buf);
  buf.writeUInt32(content.length, ISCP_DATA_SIZE_OFFSET, true);
  buf.write(content, ISCP_DATA_OFFSET, 'UTF-8');
  return buf;
}

function parseMessage(buf, offset) {
  if (offset === undefined) {
    offset = 0;
  }
  if (!Buffer.isBuffer(buf)) {
    return;
  }
  if (buf.length - offset < ISCP_HELLO.length) {
    return;
  }
  var hello = buf.toString('ascii', offset, offset + ISCP_HELLO.length);
  if (hello !== ISCP_HELLO) {
    return;
  }
  var headerSize = buf.readUInt32(offset + ISCP_HEADER_SIZE_OFFSET, true);
  var dataSize = buf.readUInt32(offset + ISCP_DATA_SIZE_OFFSET, true);
  // Messages always start with '!', followed by 1 character representing the target type
  if (buf[offset + headerSize] !== 33 /* '!' */) {
    return;
  }
  var destinationType = String.fromCharCode(buf[offset + headerSize + 1]);
  var command = buf.toString('ascii', offset + headerSize + 2, offset + headerSize + 5); // 3 character command
  var data = buf.toString('UTF-8', offset + headerSize + 5, offset + headerSize + dataSize);
  data = tools.rtrim(data);
  return {
    bytesRead: headerSize + dataSize,
    message: {
      command: command,
      data: data,
      destinationType: destinationType
    }
  };
}

function DeviceInfo(data) {
  this.address = data.address;
  this.model = data.model;
  this.iscpPort = data.iscpPort;
  this.classifier = data.classifier;
  this.type = data.type;
  this.id = data.id;
}

DeviceInfo.prototype.equals = function(other) {
  if (other.constructor === DeviceInfo) {
    return this.address === other.address &&
    this.model === other.model &&
    this.iscpPort === other.iscpPort &&
    this.classifier === other.classifier &&
    this.type === other.type &&
    this.id === other.id;
  }
};

function DeviceConnection(device) {
  var conn = this;
  this._deviceInfo = device;
  this._socket = new net.Socket();
  this._socket.setKeepAlive(true);
  this._socket.on('connect', function() {
    conn.emit('connect');
  });
  this._socket.on('data', function(data) {
    conn._receiveData(data);
  });
  this._socket.on('end', function() {
    this.close();
    conn.emit('close');
  });
  this._socket.on('timeout', function() {
    this.close();
    conn.emit('close');
  });
  this._socket.on('close', function(had_error) {
    conn.emit('close');
  });
  this._socket.connect(device.iscpPort, device.address);
}
util.inherits(DeviceConnection, events.EventEmitter);

DeviceConnection.prototype._receiveData = function(input) {
  if (this._buf !== undefined) {
    var newBuf = new Buffer(this._buf.length + input.length);
    this._buf.copy(newBuf, 0, 0);
    input.copy(newBuf, this._buf.length, 0);
    this._buf = newBuf;
  } else {
    this._buf = input;
  }
  
  var messageProcessed;
  var offset = 0;
  var parsed = parseMessage(this._buf);
  while (parsed !== undefined) {
    offset += parsed.bytesRead;
    this.emit('message', parsed.message);
    parsed = parseMessage(this._buf, offset);
  }
  if (offset > 0) {
    if (this._buf.length > offset) {
      this._buf = this._buf.slice(offset);
    } else {
      delete this._buf;
    }
  }
};

DeviceConnection.prototype.send = function(command, data) {
  if (data === undefined) {
    data = '';
  }
  var buf = createMessage(command, data, this._deviceInfo.type);
  this._socket.write(buf);
};

/**
 * An ISCP device Browser/tracker.
 *
 */
var PING_INTERVAL = 15000; // 15 seconds.
var PING_TIMEOUT = 60000; // 60 seconds.
function Browser(opts) {
  if (opts !== undefined && opts.broadcastPort !== undefined) {
    this._broadcastPort = opts.broadcastPort;
  } else {
    this._broadcastPort = 60128;
  }
  this._devices = {};
  this._init();
}
util.inherits(Browser, events.EventEmitter);

Browser.prototype._init = function() {
  this._socket = dgram.createSocket('udp4');
  this._socket.setBroadcast(1);
  var browser = this;
  this._socket.on('message', function(buf, rinfo) {
    var input = parseMessage(buf);
    if (input !== undefined && input.message.command === 'ECN') {
      var parts = input.message.data.split('/');
      if (parts.length === 4) {
        var device = new DeviceInfo({
          address: rinfo.address,
          model: parts[0],
          iscpPort: parseInt(parts[1], 10),
          classifier: parts[2],
          type: input.message.destinationType,
          id: parts[3]
        });
        browser._addOrUpdateDevice(device);
      }
    }
  });
  this._socket.once('listening', function() {
    browser.ping();
  });
  this._socket.bind();
  this._pingInterval = setInterval(function() {
    browser.ping();
    browser._pruneDevices();
  }, PING_INTERVAL);
};

Browser.prototype.shutdown = function() {
  this._socket.close();
  clearInterval(this._pingInterval);
};

Browser.prototype.ping = function() {
  var message = createMessage('ECN', 'QSTN');
  this._socket.send(message, 0, message.length, this._broadcastPort, "255.255.255.255");
};

Browser.prototype.getDevices = function() {
  var devices = this._devices;
  return Object.getOwnPropertyNames(this._devices).map(function(d) { return devices[d].device; });
};

Browser.prototype.getDevice = function(id) {
  var deviceData = this._devices[id];
  if (deviceData) {
    return deviceData.device;
  }
};

Browser.prototype._addOrUpdateDevice = function(device) {
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

Browser.prototype._pruneDevices = function() {
  for (var key in this._devices) {
    if (this._devices.hasOwnProperty(key)) {
      var deviceData = this._devices[key];
      if (deviceData.lastSeen < new Date().getTime() - PING_TIMEOUT) {
        this.emit('deviceRemoved', deviceData.device);
        delete this._devices[key];
      }
    }
  }
};

exports.Browser = Browser;
exports.DeviceConnection = DeviceConnection;