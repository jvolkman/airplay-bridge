var util = require('util');
var events = require('events');
var dgram = require('dgram');
var net = require('net');
var tools = require('./tools');

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
    return;
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
      return;
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
        return;
      }
      headers[lastHeader] = headers[lastHeader] + ' ' + tools.trim(headerString);
    } else {
      var colonPos = headerString.indexOf(':');
      if (colonPos === -1) {
        return;
      }
      var headerName = tools.rtrim(headerString.slice(0, colonPos));
      var headerValue = tools.trim(headerString.slice(colonPos + 1));
      headers[headerName] = headerValue;
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
  if (opts !== undefined && opts.broadcastPort !== undefined) {
    this._broadcastPort = opts.broadcastPort;
  } else {
    this._broadcastPort = 1900;
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
    var input = parseMessage(buf);
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
    var input = parseMessage(buf);
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

Browser.prototype.search = function(type, mx) {
  if (type === undefined) {
    type = 'upnp:rootdevice';
  }
  if (mx === undefined) {
    mx = '5';
  }
  var message = createMessage('SEARCH', {
    Host: '239.255.255.250:' + this._broadcastPort,
    Man: '"ssdp:discover"',
    ST: type,
    MX: mx
  });
  this._localSocket.send(message, 0, message.length, this._broadcastPort, '239.255.255.250');
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
