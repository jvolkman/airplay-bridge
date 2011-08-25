function Registry() {
  this.justDiscovered = {};
  this.rootDevices = [];
}

Registry.prototype.addOrUpdateDevice = function(deviceInfo) {
  if (justDiscovered.hasOwnProperty(deviceInfo.uuid)) {
    // Skip this, we're already fetching its description.
    return;
  }
  
};

Registry.prototype.findDeviceByUUID = function(uuid) {
  for (var i = 0; i < this.rootDevices; i++) {
    if (rootDevices[i].)
  }
};