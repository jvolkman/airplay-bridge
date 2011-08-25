var protocol = require('./protocol');

/**
 * Create a DiscoveredDevice from headers
 */
function DiscoveredDevice(headers, discoverType) {
  this.discoverType = discoverType;
  var requiredHeaders;
  if (discoverType === 'NOTIFY') {
    requiredHeaders = ['USN', 'Cache-Control', 'Server', 'Location', 'NT', 'NTS'];
  } else if (discoverType === 'RESPONSE') {
    requiredHeaders = ['USN', 'Cache-Control', 'Server', 'Location', 'ST'];
  } else {
    throw 'Invalid discoverType: ' + discoverType;
  }
  requiredHeaders.map(function(h) {
    if (!headers.hasOwnProperty(h.toLowerCase())) {
      throw 'Message does not contain required ' + h + ' header.';
    }
  });

  this.uuid = protocol.extractDeviceIdFromUSN(headers.usn);
  if (!this.uuid) {
    throw 'Invalid USN: ' + headers.usn;
  }

  this.server = headers.server;
  this.location = headers.location;

  var maxAgeMs = protocol.parseCacheControl(headers['cache-control']);
  var date;
  if (headers.hasOwnProperty('date')) {
    date = protocol.parseDate(headers.date);
  } else {
    date = new Date().getTime();
  }
  this.expiration = date + maxAgeMs;

  if (discoverType === 'NOTIFY') {
    this.NTS = headers.nts;
    this.NT = headers.nt;
  } else if (discoverType === 'RESPONSE') {
    this.ST = headers.st;
  }
}

DiscoveredDevice.prototype.isByeBye = function() {
  return this.NTS === 'ssdp:byebye';
};

function Device() {
  //   <deviceType>urn:schemas-upnp-org:device:deviceType:v</deviceType> 
  //   <friendlyName>short user-friendly title</friendlyName> 
  //   <manufacturer>manufacturer name</manufacturer> 
  //   <manufacturerURL>URL to manufacturer site</manufacturerURL> 
  //   <modelDescription>long user-friendly title</modelDescription> 
  //   <modelName>model name</modelName> 
  //   <modelNumber>model number</modelNumber> 
  //   <modelURL>URL to model site</modelURL> 
  //   <serialNumber>manufacturer's serial number</serialNumber> 
  //   <UDN>uuid:UUID</UDN> 
  //   <UPC>Universal Product Code</UPC> 
  //   <iconList> 
  //     <icon> 
  //       <mimetype>image/format</mimetype> 
  //       <width>horizontal pixels</width> 
  //       <height>vertical pixels</height> 
  //       <depth>color depth</depth> 
  //       <url>URL to icon</url> 
  //     </icon> 
  // <!-- XML to declare other icons, if any, go here --> 
  //   </iconList> 
  
}

exports.DiscoveredDevice = DiscoveredDevice;
exports.Device = Device;