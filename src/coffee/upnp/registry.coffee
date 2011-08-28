class Registry
  @justDiscovered = {}
  @rootDevices = []
  
  addOrUpdateDevice = (deviceInfo) ->
    if justDiscovered.hasOwnProperty deviceInfo.uuid
      return false
  
  findDeviceByUUID = (uuid) ->
    for device in @rootDevices
      null