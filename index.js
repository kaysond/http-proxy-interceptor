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

	var _write, _writeHead, _end, _isCompressed, _headersChecked, _intercept, _decompressor, _compressor, _interceptor

	function _checkHeaders(res, headers) {
		if (_filter.headers) {
			for (var headerName in _filter.headers) {
				var reqHeader = res.getHeader(headerName) || (headers ? headers[headerName] : undefined)
				if (typeof reqHeader == 'undefined' || !_filter.headers[headerName].test(reqHeader)) {
					_intercept = false
					break
				}
				else {
					_intercept = true
				}
			}
		}
		else {
			_intercept = true
		}
	}

	function _checkEncoding(res, headers) {
		var contentEncoding = res.getHeader('content-encoding') || (headers ? headers['content-encoding'] : undefined)

		if (typeof contentEncoding != 'undefined') {
			if (/\bgzip\b/.test(contentEncoding)) { //not RFC compliant testing
				_compressor = zlib.createGzip()
				_decompressor = zlib.createGunzip()
				_isCompressed = true
			}
			else if (/\bdeflate\b/.test(contentEncoding)) {
				_compressor = zlib.createDeflate()
				_decompressor = zlib.createInflate()
				_isCompressed = true
			}
		}
		if (Array.isArray(_interceptor)) {
			_decompressor.pipe(_interceptor[0])
			for (var i = 1; i < _interceptor.length; i++) {
				_interceptor[i-1].pipe(_interceptor[i])
			}
			_interceptor[_interceptor.length - 1].pipe(_compressor)
		}
		else {
			_decompressor.pipe(_interceptor).pipe(_compressor)
		}

		_compressor.on('data', function(chunk) {
			_write.call(res, chunk)
		})

		_compressor.on('end', function(chunk) {
			_end.call(res, chunk)
		})
	}

	function _prepareInterceptor(req, res) {
		_write     = res.write
		_end       = res.end
		_writeHead = res.writeHead

		_interceptor = _interceptorFactory.call(null, req, res)

		_headersChecked = false
		_intercept = false

		//Assume uncompressed
		_isCompressed = false
		_decompressor = new stream.PassThrough()
		_compressor = new stream.PassThrough()

		res.writeHead = function() {
			var code = arguments[0]
			var headers = (arguments.length > 2) ? arguments[2] : arguments[1] //writeHead() supports (statusCode, headers) as well as (statusCode, statusMessage, headers)

			var headersLC = {}
			for (header in headers) {
				headersLC[header.toLowerCase()] = headers[header]
			}

			if (!_headersChecked) {
				_checkHeaders(res, headersLC)
				if (_intercept) {
					_checkEncoding(res, headersLC)
				}
				_headersChecked = true
			}
			if (_intercept && !res.headersSent) {
				//Strip off the content length since chunked encoding must be used
				res.removeHeader('content-length')
				if (typeof headers == 'object') {
					for (var header in headers) {
						if (header.toLowerCase() == 'content-length')
							delete headers[header]
					}
				}
			}
			_writeHead.apply(res, arguments)
		}

		res.write = function(data, encoding) {
			//In case writeHead() hasn't been called yet
			if (!_headersChecked) {
				_checkHeaders(res)
				if (_intercept) {
					_checkEncoding(res)
				}
				_headersChecked = true
			}
			if (_intercept) {
				_decompressor.write(data, encoding)
			}
			else {
				_write.apply(res, arguments)
			}
		}

		res.end = function(data, encoding) {
			//In case writeHead() or write() haven't been called yet
			if (!_headersChecked) {
				_checkHeaders(res)
				if (_intercept) {
					_checkEncoding(res)
				}
				_headersChecked = true
			}
			if (_intercept) {
				_decompressor.end(data, encoding)
			}
			else {
				_end.apply(res, arguments)
			}
		}
	}

	return function httpProxyInterceptor(req, res, next) {
		if (!_filter.url || _filter.url.test(decodeURI(req.url))) {
			_prepareInterceptor(req, res)
		}

		next()
	}
}