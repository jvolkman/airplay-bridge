var repl = require("repl");
var net = require('net');

var iscp = require('./lib/iscp');
var upnp = require('./lib/upnp');
var b = new iscp.Browser();
var ub = new upnp.Browser();
var c = [];
b.on('deviceAdded', function(device) {
  console.log('Device added: ');
  console.log(device);
  
  var conn = new iscp.DeviceConnection(device);
  conn.on('message', function(message) {
    console.log(message);
  });
  c[0] = conn;
});
b.on('deviceRemoved', function(device) {
  console.log('Device removed: ');
  console.log(device);
});

var r = repl.start('node> ');
r.context.b = b;
r.context.c = c;