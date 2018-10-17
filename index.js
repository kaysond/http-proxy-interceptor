'use strict'
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

	function attachInterceptor(req, res, filter, factory) {
		//Prepare interception framework
		if (typeof res.interceptor === 'undefined') {
			res.interceptor = new interceptor(res)

			res.writeHead = function() {
				var headers = (arguments.length > 2) ? arguments[2] : arguments[1] //writeHead() supports (statusCode, headers) as well as (statusCode, statusMessage, headers)
				res.interceptor.checkHeaders(req, res, headers)
				res.interceptor.writeHeadOrig.apply(res, arguments)
			}

			res.write = function(data, encoding) {
				//In case writeHead() hasn't been called yet
				res.interceptor.checkHeaders(req, res)				
				res.interceptor.write(data, encoding)
			}

			res.end = function(data, encoding) {
				//In case writeHead() or write() haven't been called yet
				res.interceptor.checkHeaders(req, res)
				res.interceptor.end(data, encoding)
			}

		}

		res.interceptor.add(filter, factory)
	}

	return function httpProxyInterceptor(req, res, next) {
		if (!_filter.url || _filter.url.test(decodeURI(req.url))) {
			attachInterceptor(req, res, _filter.headers, _interceptorFactory)
		}

		next()
	}
}

class interceptor {
	constructor(res) {
		this.filters         = new Array()
		this.streamFactories = new Array()
		this.streams         = new Array()
		this.decompressor    = new stream.PassThrough()
		this.compressor      = new stream.PassThrough()
		this.writeOrig       = res.write
		this.endOrig         = res.end
		this.writeHeadOrig   = res.writeHead
		this.headersChecked  = false
	}

	add(filter, factory) {
		this.filters.push(filter)
		this.streamFactories.push(factory)
	}

	write(data, encoding) {
		this.decompressor.write(data, encoding)
	}

	end(data, encoding) {

		this.decompressor.end(data, encoding)
	}

	checkHeaders(req, res, headers) {
		if (!this.headersChecked) {
			for (var i = 0; i < this.filters.length; i++) {
				//Always add streams where there was no header filter
				if (typeof this.filters[i] === 'undefined') {
					var streams = this.streamFactories[i].call(null, req, res)
					if (typeof streams[Symbol.iterator] === 'function')+
						this.streams.push(...streams)
					else
						this.streams.push(streams)
				}
				else {
					var filterMatched = true
					for (var headerName in this.filters[i]) {
						var reqHeader = res.getHeader(headerName) || (headers ? headers[headerName] : undefined)
						if (typeof reqHeader === 'undefined' || !this.filters[i][headerName].test(reqHeader)) {
							filterMatched = false
							break
						}
					}
					if (filterMatched) {
						var streams = this.streamFactories[i].call(null, req, res)
						if (typeof streams[Symbol.iterator] === 'function')
							this.streams.push(...streams)
						else
							this.streams.push(streams)
					}
				}
			}

			if (this.streams.length > 0) {
				//Remove content length headers since it must be sent chunked
				res.removeHeader('content-length')
				if (typeof headers === 'object') {
					for (var header in headers) {
						if (header.toLowerCase() == 'content-length')
							delete headers[header]
					}
				}

				var contentEncoding = res.getHeader('content-encoding')
				if (typeof contentEncoding === 'undefined' && typeof headers === 'object') {
					for (var header in headers) {
						if (header.toLowerCase() == 'content-encoding')
							contentEncoding = headers[header]
					}
				}

				if (typeof contentEncoding !== 'undefined') {
					if (/\bgzip\b/.test(contentEncoding)) { //not RFC compliant testing
						this.compressor = zlib.createGzip()
						this.decompressor = zlib.createGunzip()
					}
					else if (/\bdeflate\b/.test(contentEncoding)) {
						this.compressor = zlib.createDeflate()
						this.decompressor = zlib.createInflate()
					}
				}
				
				this.decompressor.pipe(this.streams[0])
				for (var i = 1; i < this.streams.length; i++) {
					this.streams[i-1].pipe(this.streams[i])
				}
				this.streams[this.streams.length-1].pipe(this.compressor)
			}
			else {
				//Write directly to the response if there is no interception
				this.decompressor.pipe(this.compressor)
			}

			this.compressor.on('data', function(chunk) {
				this.writeOrig.call(res, chunk)
			}.bind(this))

			this.compressor.on('end', function(chunk) {
				this.endOrig.call(res, chunk)
			}.bind(this))

			this.headersChecked = true
		}
	} //checkHeaders()
} //class interceptor