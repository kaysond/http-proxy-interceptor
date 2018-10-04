/*******************************************************
Use trumpet (https://github.com/substack/node-trumpet)
to select the <head> element in html responses and
append a <style> that rotates all images

Visit http://localhost:8000 to see the result
********************************************************/
const connect = require('connect')
const http = require('http')
const httpProxy = require('http-proxy')
const trumpet = require('trumpet')
const httpProxyInterceptor = require('../')

const interceptorFactory = function() {
	var out = '<style type="text/css"> img { ';
    out +='-webkit-transform: rotate(180deg); ';
    out += '-moz-transform: rotate(180deg); ';
	out += 'filter: progid:DXImageTransform.Microsoft.BasicImage(rotation=2);}</style>';

	const tr = trumpet()
	const elem = tr.select('head')
	const rs = elem.createReadStream()
	const ws = elem.createWriteStream()
	rs.pipe(ws, { end: false })
	rs.on('end', function() {
		ws.end(out)
	})

	return tr
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
app.use(httpProxyInterceptor(interceptorFactory), {headers: {'content-type': /text\/html/}})
app.use(function(req, res) {
	proxy.web(req, res)
})
http.createServer(app).listen(port)