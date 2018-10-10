const expect = require('chai').expect
const connect = require('connect')
const express = require('express')
const httpProxy = require('http-proxy')
const replace = require('stream-replace')
const trumpet = require('trumpet')
const http = require('http')
const url = require('url')
const stream = require('stream')
const zlib = require('zlib')
const httpProxyInterceptor = require('../')

//From node-http-proxy/test/lib-http-proxy-test.js
var initialPort = 1024, gen = {};
Object.defineProperty(gen, 'port', {
  get: function get() {
    return initialPort++;
  }
});

describe('Filtering', function() {
	var intercepted, interceptor, proxyInterceptor

	const port = gen.port
	const server = http.createServer(function(req, res) {
		proxyInterceptor(req, res, new Function())
		//Allow response headers to be set in the request
		const headers = url.parse(req.url, true).query
		res.writeHead(200, headers)
		res.end('foo')

	}).listen(port)

	beforeEach(function() {
		intercepted = false
		interceptor = new stream.PassThrough()
		interceptor.on('end', () => {
			intercepted = true
		})
	})
	after(function() {
		server.close()
	})

	it('should intercept any request when passed no url or headers', function(done) {
		proxyInterceptor = httpProxyInterceptor(function() { return interceptor })
		http.get(`http://localhost:${port}/foo bar123?foo=bar`, function(res) {
			res.on('data', new Function())
			res.on('end', function() {
				expect(intercepted).to.be.true
				done()
			})
		}).end()
	})

	describe('By URL', function() {
		beforeEach(() => {
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor }, {url:/foo\s+bar\d+/})
		})
		
		it('should intercept requests with matching URLs', function(done) {
			http.get(`http://localhost:${port}/foo  bar123`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.true
					done()
				})
			}).end()
		})
		it('should not intercept requests without matching URLs', function(done) {
			http.get(`http://localhost:${port}/`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.false
					done()
				})
			}).end()
		})
	})
	describe('By header', function() {
		const headers = {
			'content-type': /text\/html/,
			'content-encoding': /^identity$/,
			'foo': /bar/
		}
		beforeEach(() => {
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor }, {headers: headers})
		})

		it('should intercept requests with all specified headers matching', function(done) {
			http.get(`http://localhost:${port}/foo bar123?content-type=text/html&content-encoding=identity&foo=bar`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.true
					done()
				})
			}).end()
		})
		it('should not intercept requests where one specified header does not match', function(done) {
			http.get(`http://localhost:${port}/foo bar123?content-type=text/css&content-encoding=identity&foo=bar`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.false
					done()
				})
			}).end()
		})
		it('should not intercept requests where multiple specified headers do not match', function(done) {
			http.get(`http://localhost:${port}/foo bar123?content-type=text/css&content-encoding=identity&foo=foo`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.false
					done()
				})
			}).end()
		})
		it('should not intercept requests where a specified header is undefined', function(done) {
			http.get(`http://localhost:${port}/foo bar123?content-type=text/html&content-encoding=identity`, function(res) {
				res.on('data', new Function())
				res.on('end', function() {
					expect(intercepted).to.be.false
					done()
				})
			}).end()
		})
	})
})

describe('Interception', function() {
	it('should actually change the response', function(done) {
		const interceptor = new stream.Transform({
			transform(chunk, encoding, callback) {
				this.push(Buffer.concat([chunk, new Buffer.from("bar")]))
				callback()
			}
		})
		const proxyInterceptor = httpProxyInterceptor(function() { return interceptor })		
		const port = gen.port
		const server = http.createServer(function(req, res) {
			proxyInterceptor(req, res, new Function())
			res.write('foo')
			res.end('foo')
		}).listen(port)
		http.get(`http://localhost:${port}/`, function(res) {
			var body = ''
			res.on('data', chunk => { body += chunk.toString() })
			res.on('end', function() {
				expect(body).to.equal('foobarfoobar')
				server.close()
				done()
			})
		}).end()
	})
	it('should remove content-length headers and use chunked transfer-encoding', function(done) {
		const interceptor = new stream.PassThrough()
		const proxyInterceptor = httpProxyInterceptor(function() { return interceptor })		
		const port = gen.port
		const server = http.createServer(function(req, res) {
			proxyInterceptor(req, res, new Function())
			res.writeHead(200, {'content-length': 3, 'ContenT-lEnGth': 6})
			res.write('foo')
			res.end('bar')
		}).listen(port)
		http.get(`http://localhost:${port}/`, function(res) {
			var body = ''
			res.on('data', chunk => { body += chunk.toString() })
			res.on('end', function() {
				expect(body).to.equal('foobar')
				expect(res.headers['content-length']).to.be.undefined
				expect(res.headers['transfer-encoding']).to.equal('chunked')
				server.close()
				done()
			})
		}).end()
	})
	it('should handle multiple simultaneous requests', function(done) {
		const proxyInterceptor = httpProxyInterceptor(function() { return new stream.PassThrough() })		
		const port = gen.port
		const server = http.createServer(function(req, res) {
			proxyInterceptor(req, res, new Function())
			res.writeHead(200, {'content-length': 3, 'ContenT-lEnGth': 6})
			res.write('foo')
			res.end('bar')
		}).listen(port)

		function httpGetPromise(resolve, reject) {
			http.get(`http://localhost:${port}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(body).to.equal('foobar')
					resolve(true)
				})
			}).end()
		}

		Promise.all([new Promise(httpGetPromise), new Promise(httpGetPromise)]).then(values => {
			expect(values).to.deep.equal([true, true])
			server.close()
			done()
		})
	})
	it('should properly chain multiple interceptor streams', function (done) {
		const interceptor1 = new stream.Transform({
			transform(chunk, encoding, callback) {
				this.push(Buffer.concat([chunk, new Buffer.from("bar")]))
				callback()
			}
		})
		const interceptor2 = new stream.Transform({
			transform(chunk, encoding, callback) {
				this.push(Buffer.concat([chunk, new Buffer.from("baz")]))
				callback()
			}
		})
		const proxyInterceptor = httpProxyInterceptor(function() { return [interceptor1, interceptor2] })		
		const port = gen.port
		const server = http.createServer(function(req, res) {
			proxyInterceptor(req, res, new Function())
			res.write('foo')
			res.end('foo')
		}).listen(port)
		http.get(`http://localhost:${port}/`, function(res) {
			var body = ''
			res.on('data', chunk => { body += chunk.toString() })
			res.on('end', function() {
				expect(body).to.equal('foobarbazfoobarbaz')
				server.close()
				done()
			})
		}).end()
	})
})

describe('Compression', function() {
	var proxyInterceptor, interceptor, encoding
	var compressor
	const port = gen.port
	const server = http.createServer(function(req, res) {
			proxyInterceptor(req, res, new Function())
			res.writeHead(200, {'ConteNt-encoDing': encoding}) //mixed case to test lowercasing
			compressor.pipe(res)
			compressor.write('foo')
			compressor.end('bar')
		}).listen(port)

	after(() => {
		server.close()
	})

	describe('gzip', function() {
		before(() => {
			encoding = 'gzip'
		})
		beforeEach(() => {
			compressor = zlib.createGzip()
		})
		it('should properly decode the response and stream it to the interceptor', function(done) {
			interceptor = new stream.PassThrough()
			var body = ''
			interceptor.on('data', chunk => { body += chunk.toString() })
			interceptor.on('end', function() {
				expect(body).to.equal('foobar')
			})
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor })
			http.get(`http://localhost:${port}/`, function(res) {
				res.on('data', new Function())
				res.on('end', done)
			}).end()
		})
		it('should properly encode the output of the interceptor', function(done) {
			interceptor = new stream.Transform({
				transform(chunk, encoding, callback) {
					this.push(Buffer.concat([chunk, new Buffer.from("bar")]))
					callback()
				}
			})
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor })
			http.get(`http://localhost:${port}/`, function(res) {
				expect(res.headers['content-encoding']).to.equal('gzip')
				const decompressor = zlib.createGunzip()
				res.pipe(decompressor)
				var body = ''
				decompressor.on('data', chunk => { body += chunk.toString() })
				decompressor.on('end', function() {
					expect(body).to.equal('foobarbar') //gzip lumps the write('foo') and end('bar') into one chunk
					done()
				})
			}).end()
		})
	})
	describe('deflate', function() {
		before(() => {
			encoding = 'deflate'
		})
		beforeEach(() => {
			compressor = zlib.createDeflate()
		})
		it('should properly decode the response and stream it to the interceptor', function(done) {
			interceptor = new stream.PassThrough()
			var body = ''
			interceptor.on('data', chunk => { body += chunk.toString() })
			interceptor.on('end', function() {
				expect(body).to.equal('foobar')
			})
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor })
			http.get(`http://localhost:${port}/`, function(res) {
				res.on('data', new Function())
				res.on('end', done)
			}).end()
		})
		it('should properly encode the output of the interceptor', function(done) {
			interceptor = new stream.Transform({
				transform(chunk, encoding, callback) {
					this.push(Buffer.concat([chunk, new Buffer.from("bar")]))
					callback()
				}
			})
			proxyInterceptor = httpProxyInterceptor(function() { return interceptor })
			http.get(`http://localhost:${port}/`, function(res) {
				expect(res.headers['content-encoding']).to.equal('deflate')
				const decompressor = zlib.createInflate()
				res.pipe(decompressor)
				var body = ''
				decompressor.on('data', chunk => { body += chunk.toString() })
				decompressor.on('end', function() {
					expect(body).to.equal('foobarbar') //gzip lumps the write('foo') and end('bar') into one chunk
					done()
				})
			}).end()
		})
	})
})

describe('Middleware', function() {
	const remotePort = gen.port
	const remoteServer = http.createServer(function(req, res) {
		res.writeHead(200)
		res.end('foo bar')
	}).listen(remotePort)

	var intercepted, intercepted2
	beforeEach(() => {
		intercepted = false
		intercepted2 = false
	})

	var interceptorFactory = function() {
		interceptor = new stream.PassThrough()
		interceptor.on('end', function() {
			intercepted = true
		})
		return interceptor
	}

	var interceptorFactory2 = function() {
		interceptor = new stream.PassThrough()
		interceptor.on('end', function() {
			intercepted2 = true
		})
		return interceptor
	}

	after(() => {
		remoteServer.close()
	})

	describe('connect', function() {
		it('should properly intercept and pass responses', function(done) {
			const proxy = httpProxy.createProxyServer({target: `http://localhost:${remotePort}/`})
			const app = connect()
			app.use(httpProxyInterceptor(interceptorFactory))
			app.use(function(req, res) {
				proxy.web(req, res)
			})
			const localPort = gen.port
			const localServer = http.createServer(app).listen(localPort)

			http.get(`http://localhost:${localPort}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(intercepted).to.be.true
					expect(body).to.equal('foo bar')
					localServer.close()
					done()
				})
			}).end()
		})
		it('should support using multiple instantiations', function(done) {
			const proxy = httpProxy.createProxyServer({target: `http://localhost:${remotePort}/`})
			const app = connect()
			app.use(httpProxyInterceptor(interceptorFactory))
			app.use(httpProxyInterceptor(interceptorFactory2))
			app.use(function(req, res) {
				proxy.web(req, res)
			})
			const localPort = gen.port
			const localServer = http.createServer(app).listen(localPort)

			http.get(`http://localhost:${localPort}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(intercepted).to.be.true
					expect(intercepted2).to.be.true
					expect(body).to.equal('foo bar')
					localServer.close()
					done()
				})
			}).end()
		})
	})
	describe('express', function() {
		it('should properly intercept and pass responses', function(done) {
			const proxy = httpProxy.createProxyServer({target: `http://localhost:${remotePort}/`})
			const app = express()
			app.use(httpProxyInterceptor(interceptorFactory))
			app.use(function(req, res) {
				proxy.web(req, res)
			})
			const localPort = gen.port
			const localServer = app.listen(localPort)

			http.get(`http://localhost:${localPort}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(intercepted).to.be.true
					expect(body).to.equal('foo bar')
					localServer.close()
					done()
				})
			}).end()
		})
		it('should support using multiple instantiations', function(done) {
			const proxy = httpProxy.createProxyServer({target: `http://localhost:${remotePort}/`})
			const app = express()
			app.use(httpProxyInterceptor(interceptorFactory))
			app.use(httpProxyInterceptor(interceptorFactory2))
			app.use(function(req, res) {
				proxy.web(req, res)
			})
			const localPort = gen.port
			const localServer = app.listen(localPort)

			http.get(`http://localhost:${localPort}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(intercepted).to.be.true
					expect(intercepted2).to.be.true
					expect(body).to.equal('foo bar')
					localServer.close()
					done()
				})
			}).end()
		})
	})
})

describe('Streams', function() {
	var proxyInterceptor
	const port = gen.port
	const server = http.createServer(function(req, res) {
		proxyInterceptor(req, res, new Function())
		res.writeHead(200, {'content-type': 'text/html'})
		res.end('<html><head><title>foo</title></head><body><div>bar</div></body></html>')
	}).listen(port)

	after(() => {
		server.close()
	})

	describe('stream-replace', function() {
		it('should properly modify responses', function(done) {
			proxyInterceptor = httpProxyInterceptor(function() { return replace(/div/g, 'span') })		
			
			http.get(`http://localhost:${port}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(body).to.equal('<html><head><title>foo</title></head><body><span>bar</span></body></html>')
					done()
				})
			}).end()
		})
	})
	describe('trumpet', function() {
		it('should properly modify responses', function(done) {
			proxyInterceptor = httpProxyInterceptor(function() { 
				var tr = trumpet()
				var ws = tr.select('div').createWriteStream()
				ws.end('<span>bar</span>')
				return tr
			})		
			
			http.get(`http://localhost:${port}/`, function(res) {
				var body = ''
				res.on('data', chunk => { body += chunk.toString() })
				res.on('end', function() {
					expect(body).to.equal('<html><head><title>foo</title></head><body><div><span>bar</span></div></body></html>')
					done()
				})
			}).end()
		})
	})
})