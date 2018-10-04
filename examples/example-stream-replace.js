/**********************************************************
Use stream-replace (https://github.com/lxe/stream-replace)
to regexp-replace certain colors with red in css responses

Visit http://localhost:8000 to see the result
**********************************************************/

const connect = require('connect')
const http = require('http')
const httpProxy = require('http-proxy')
const replace = require('stream-replace')
const httpProxyInterceptor = require('../')

const interceptorFactory = function() {
	return replace(/(?:#43853d|#026e00|#333)/g, 'red')
}

const port = 8000
const options = {
	target: "https://nodejs.org/",
	changeOrigin: true,
	hostRewrite: `localhost:${port}`,
	protocolRewrite: "http",
	cookieDomainRewrite: "localhost"
}
var proxy = httpProxy.createProxyServer(options)
var app = connect()
app.use(httpProxyInterceptor(interceptorFactory, {headers: {'content-type': /text\/css/}}))
app.use(function(req, res) {
	proxy.web(req, res)
})
http.createServer(app).listen(port)