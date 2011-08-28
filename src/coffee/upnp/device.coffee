protocol = require './protocol'

###
# Create a DiscoveredDevice from headers
###
class DiscoveredDevice
  constructor: (headers, @discoverType) ->
    requiredHeaders = switch discoverType
      when 'NOTIFY' then ['USN', 'Cache-Control', 'Server', 'Location', 'NT', 'NTS']
      when 'RESPONSE' then ['USN', 'Cache-Control', 'Server', 'Location', 'ST']
      else throw "Invalid discoverType: #{discoverType}"

    for h in requiredHeaders
      throw "Message does not contain required #{h} header." unless headers.hasOwnProperty h.toLowerCase()
      
    @uuid = protocol.extractDeviceIdFromUSN headers.usn
    throw "Invalid USN: #{headers.usn}" unless @uuid?
    
    @server = headers.server
    @location = headers.location
    
    maxAgeMs = protocol.parseCacheControl headers['cache-control']
    
    if headers.hasOwnProperty 'date'
      date = protocol.parseDate headers.date
    else
      date = new Date().getTime()
      
    @expiration = date + maxAgeMs
    
    if discoverType is 'NOTIFY'
      @NTS = headers.nts
      @NT = headers.nt
    else if discoverType is 'RESPONSE'
      @ST = headers.st
      
  isByeBye: () -> @NTS is 'ssdp:byebye'

class Device 
  # //   <deviceType>urn:schemas-upnp-org:device:deviceType:v</deviceType> 
  # //   <friendlyName>short user-friendly title</friendlyName> 
  # //   <manufacturer>manufacturer name</manufacturer> 
  # //   <manufacturerURL>URL to manufacturer site</manufacturerURL> 
  # //   <modelDescription>long user-friendly title</modelDescription> 
  # //   <modelName>model name</modelName> 
  # //   <modelNumber>model number</modelNumber> 
  # //   <modelURL>URL to model site</modelURL> 
  # //   <serialNumber>manufacturer's serial number</serialNumber> 
  # //   <UDN>uuid:UUID</UDN> 
  # //   <UPC>Universal Product Code</UPC> 
  # //   <iconList> 
  # //     <icon> 
  # //       <mimetype>image/format</mimetype> 
  # //       <width>horizontal pixels</width> 
  # //       <height>vertical pixels</height> 
  # //       <depth>color depth</depth> 
  # //       <url>URL to icon</url> 
  # //     </icon> 
  # // <!-- XML to declare other icons, if any, go here --> 
  # //   </iconList> 

exports.DiscoveredDevice = DiscoveredDevice
exports.Device = Device