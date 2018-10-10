const zlib = require('zlib')
const stream = require('stream')

module.exports = function httpProxyInterceptor(interceptorFactory, filter) {
	var _interceptorFactory = interceptorFactory
	var _filter = filter || { url: /.*/ }
	//Make all headers lowercase all the time for easier comparisons
	if (_filter.headers) {
		var headersLC = {}
		for (var header in _filter.headers) {
			headersLC[header.toLowerCase()] = _filter.headers[header]
		}
		_filter.headers = headersLC
	}

	function prepareInterceptor(req, res) {
		var _write     = res.write
		var _end       = res.end
		var _writeHead = res.writeHead

		res.interceptor = _interceptorFactory.call(null, req, res)

		//Assume response is uncompressed by default
		res.isCompressed = false
		res.decompressor = new stream.PassThrough()
		res.compressor = new stream.PassThrough()

		//Check headers for encoding and match before first _write()
		res.headersChecked = false

		//Don't intercept unless its a match
		res.intercept = false

		res.checkHeaders = function(headers) {
			if (_filter.headers) {
				for (var headerName in _filter.headers) {
					var reqHeader = res.getHeader(headerName) || (headers ? headers[headerName] : undefined)
					if (typeof reqHeader == 'undefined' || !_filter.headers[headerName].test(reqHeader)) {
						res.intercept = false
						break
					}
					else {
						res.intercept = true
					}
				}
			}
			else {
				res.intercept = true
			}
		}	

		res.checkEncoding = function(headers) {
			var contentEncoding = res.getHeader('content-encoding') || (headers ? headers['content-encoding'] : undefined)

			if (typeof contentEncoding != 'undefined') {
				if (/\bgzip\b/.test(contentEncoding)) { //not RFC compliant testing
					res.compressor = zlib.createGzip()
					res.decompressor = zlib.createGunzip()
					res.isCompressed = true
				}
				else if (/\bdeflate\b/.test(contentEncoding)) {
					res.compressor = zlib.createDeflate()
					res.decompressor = zlib.createInflate()
					res.isCompressed = true
				}
			}
			if (Array.isArray(res.interceptor)) {
				res.decompressor.pipe(res.interceptor[0])
				for (var i = 1; i < res.interceptor.length; i++) {
					res.interceptor[i-1].pipe(res.interceptor[i])
				}
				res.interceptor[res.interceptor.length - 1].pipe(res.compressor)
			}
			else {
				res.decompressor.pipe(res.interceptor).pipe(res.compressor)
			}

			res.compressor.on('data', function(chunk) {
				_write.call(res, chunk)
			})

			res.compressor.on('end', function(chunk) {
				_end.call(res, chunk)
			})
		}

		res.writeHead = function() {
			var code = arguments[0]
			var headers = (arguments.length > 2) ? arguments[2] : arguments[1] //writeHead() supports (statusCode, headers) as well as (statusCode, statusMessage, headers)

			var headersLC = {}
			for (header in headers) {
				headersLC[header.toLowerCase()] = headers[header]
			}

			if (!res.headersChecked) {
				res.checkHeaders(headersLC)
			}
			if (!res.headersChecked && res.intercept) {
				res.checkEncoding(headersLC)
			}
			if (res.intercept && !res.headersSent) {
				//Strip off the content length since chunked encoding must be used
				res.removeHeader('content-length')
				if (typeof headers == 'object') {
					for (var header in headers) {
						if (header.toLowerCase() == 'content-length')
							delete headers[header]
					}
				}
			}
			res.headersChecked = true
			_writeHead.apply(res, arguments)
		}

		res.write = function(data, encoding) {
			//In case writeHead() hasn't been called yet
			if (!res.headersChecked) {
				res.checkHeaders()
				if (res.intercept) {
					res.checkEncoding()
				}
				res.headersChecked = true
			}
			if (res.intercept) {
				res.decompressor.write(data, encoding)
			}
			else {
				_write.apply(res, arguments)
			}
		}

		res.end = function(data, encoding) {
			//In case writeHead() or write() haven't been called yet
			if (!res.headersChecked) {
				res.checkHeaders()
				if (res.intercept) {
					res.checkEncoding()
				}
				res.headersChecked = true
			}
			if (res.intercept) {
				res.decompressor.end(data, encoding)
			}
			else {
				_end.apply(res, arguments)
			}
		}
	}

	return function httpProxyInterceptor(req, res, next) {
		if (!_filter.url || _filter.url.test(decodeURI(req.url))) {
			prepareInterceptor(req, res)
		}

		next()
	}
}