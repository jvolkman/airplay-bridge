var util = require('util');
var events = require('events');
var dgram = require('dgram');
var net = require('net');
var tools = require('./tools');
var HTTPParser = process.binding('http_parser').HTTPParser;

var parser = new HTTPParser('request');

parser.onMessageBegin = function() {
  parser.incoming = { parameters: {} };
  parser.field = undefined;
  parser.value = undefined;
};

// Only servers will get URL events.
parser.onURL = function(b, start, len) {
  var slice = b.toString('ascii', start, start + len);
  if (parser.incoming.url !== undefined) {
    parser.incoming.url += slice;
  } else {
    // Almost always will branch here.
    parser.incoming.url = slice;
  }
};

parser.onHeaderField = function(b, start, len) {
  var slice = b.toString('ascii', start, start + len).toLowerCase();
  if (parser.value !== undefined) {
    parser.incoming.parameters[parser.field] = parser.value;
    parser.field = undefined;
    parser.value = undefined;
  }
  if (parser.field !== undefined) {
    parser.field += slice;
  } else {
    parser.field = slice;
  }
};

parser.onHeaderValue = function(b, start, len) {
  var slice = b.toString('ascii', start, start + len);
  if (parser.value !== undefined) {
    parser.value += slice;
  } else {
    parser.value = slice;
  }
};

parser.onHeadersComplete = function(info) {
  if (parser.field !== undefined && parser.value !== undefined) {
    parser.incoming.parameters[parser.field] = parser.value;
    parser.field = undefined;
    parser.value = undefined;
  }

  parser.incoming.httpVersionMajor = info.versionMajor;
  parser.incoming.httpVersionMinor = info.versionMinor;
  parser.incoming.httpVersion = info.versionMajor + '.' + info.versionMinor;

  if (info.method) {
    // server only
    parser.incoming.method = info.method;
  } else {
    // client only
    parser.incoming.statusCode = info.statusCode;
  }
};

parser.onMessageComplete = function() {
  parser.incoming.complete = true;
  if (parser.field !== undefined && parser.value !== undefined) {
    parser.incoming.parameters[parser.field] = parser.value;
  }
  delete parser.field;
  delete parser.value;
};

function parseMessage(buf, messageType) {
  parser.reinitialize(messageType);
  parser.execute(buf, 0, buf.length);
  if (parser.incoming && parser.incoming.complete) {
    var msg = parser.incoming;
    delete parser.incoming;
    delete msg.complete;
    return msg;
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
      return;
  }
  var len = firstLine.length + 2;
  for (key in parameters) {
    if (parameters.hasOwnProperty(key)) {
      param = parameters[key];
      if (typeof(param) !== 'string') {
        return;
      }
      len += key.length + param.length + 4;
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
      pos += buf.write(param, pos, 'ascii');
      pos += buf.write('\r\n', pos, 'ascii');
    }
  }
  buf.write('\r\n', pos, 2, 'ascii');
  return buf;
}

/**
 * An ISCP device Browser/tracker.
 *
 */
var SEARCH_INTERVAL = 15000; // 15 seconds.
var SEARCH_TIMEOUT = 60000; // 60 seconds.
function Browser(opts) {
  this._broadcastAddress = '239.255.255.250';
  this._broadcastPort = 1900;
  if (opts !== undefined) {
    if (opts.broadcastAddress !== undefined) {
      this._broadcastAddress = opts.broadcastAddress;
    }
    if (opts.broadcastPort !== undefined) {
      this._broadcastPort = opts.broadcastPort;
    }
  }
  this._devices = {};
  this._init();
}
util.inherits(Browser, events.EventEmitter);

Browser.prototype._init = function() {
  this._multicastSocket = dgram.createSocket('udp4');
  this._localSocket = dgram.createSocket('udp4');
  this._multicastSocket.setBroadcast(1);
  this._localSocket.setBroadcast(1);
  var browser = this;
  this._multicastSocket.on('message', function(buf, rinfo) {
    var input = parseMessage(buf, 'request');
    if (input !== undefined) {
      // switch(input.type) {
      //   default:
          console.log('MULTI:');
          console.log(input);
          // break;
      // }
    }
  });
  this._localSocket.on('message', function(buf, rinfo) {
    var input = parseMessage(buf, 'response');
    if (input !== undefined) {
      // switch(input.type) {
      //   default:
          console.log('LOCAL:');
          console.log(input);
      //     break;
      // }
    }
  });
  this._localSocket.once('listening', function() {
    browser.search();
  });
  this._multicastSocket.bind(this._broadcastPort);
  this._multicastSocket.addMembership('239.255.255.250');
  this._localSocket.bind();
  this._searchInterval = setInterval(function() {
    browser.search();
    browser._pruneDevices();
  }, SEARCH_INTERVAL);
};

Browser.prototype.shutdown = function() {
  this._multicastSocket.close();
  this._localSocket.close();
  clearInterval(this._pingInterval);
};

Browser.prototype.search = function(types, mx) {
  if (types === undefined) {
    types = ['ssdp:all'];
  } else if (!Array.isArray(types)) {
    types = [types];
  }
  if (mx === undefined) {
    mx = '5';
  }

  var browser = this;
  types.map(function(type) {
    var message = createMessage('SEARCH', {
      Host: browser._broadcastAddress + ':' + browser._broadcastPort,
      Man: '"ssdp:discover"',
      ST: type,
      MX: mx
    });
    browser._localSocket.send(message, 0, message.length, browser._broadcastPort, browser._broadcastAddress);
  });
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
      if (deviceData.lastSeen < new Date().getTime() - SEARCH_TIMEOUT) {
        this.emit('deviceRemoved', deviceData.device);
        delete this._devices[key];
      }
    }
  }
};

exports.Browser = Browser;
