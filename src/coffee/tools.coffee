exports.trim = (str) ->
  str = str.toString()
  start = 0
  end = str.length - 1
  start++ while start < str.length and str.charCodeAt(start) < 33
  end-- while end > start and str.charCodeAt(end) < 33
  return str.substring start, end + 1

exports.rtrim = (str) ->
  str = str.toString()
  end = str.length - 1
  end-- while end > 0 and str.charCodeAt(end) < 33
  return str.substr 0, end + 1
