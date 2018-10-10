# http-proxy-interceptor [![Build Status](https://travis-ci.org/kaysond/http-proxy-interceptor.svg?branch=master)](https://travis-ci.org/kaysond/http-proxy-interceptor)
`http-proxy-interceptor` is a middleware for [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) that modifies responses using streams
## Installation
`npm install http-proxy-interceptor`

## Usage
```javascript
httpProxyInterceptor(interceptorFactory[, filter])
```
`interceptorFactory` is a required `callable` that receives two arguments (`req` and `res`) and should return a [Transform Stream](https://nodejs.org/dist/latest-v10.x/docs/api/stream.html#stream_implementing_a_transform_stream). This stream receives and transforms the http response body. `interceptorFactory` can also return an `Array` of Transform Streams. In this case, the constituent streams will be turned into a pipe chain, with the first array element being first in the chain, etc.

`filter` is an optional `Object` with one or two properties:
* `url`: a `RegExp` against which ***request*** URL's are tested. Only responses whose request URL matches get intercepted
* `headers`: an `Object` whose keys are header names and values are `RegExp`'s against which the ***response*** headers are tested. Only responses where all of the headers match are intercepted. If any of the specified filter headers do not exist in the response, the match fails.

If no filter is passed, all responses are intercepted.

## Example
```javascript
const connect = require('connect')
const http = require('http')
const httpProxy = require('http-proxy')
const httpProxyInterceptor = require('http-proxy-interceptor')

var interceptorFactory = function(req, res) {
    //Use different streams depending on the request
    if (/\.css$/.test(req.url))
        return new cssModifyingStream()
    else
        return [new otherModifyingStream(), new otherModifyingStream(withArguments)]
}

const filter = {
    url: /\/\w+/, //Only match non-root requests
    headers: {
        'content-type': /text/ //Only match requests that specify text-based content types
    }
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
app.use(httpProxyInterceptor(interceptorFactory, filter))
app.use(function(req, res) {
    proxy.web(req, res)
})
var server = http.createServer(app).listen(port)
```

Also see [examples](./examples)

## Notes
The middleware handles `gzip` and `deflate` compression automatically, based on the `Content-Encoding` header in the response. The http response is passed through a decompression stream before arriving at the intercepting transform stream, and through a compression stream before being sent to the next middleware.

Because transform streams (and compression) can arbitrarily change the response length, a fixed `Content-Length` header will not work. If one exists, the middleware will remove it. The middleware always uses`Transfer-Encoding: chunked`.

### License

>The MIT License (MIT)
>
>Copyright (c) 2018 Aram Akhavan
>
>Permission is hereby granted, free of charge, to any person obtaining a copy
>of this software and associated documentation files (the "Software"), to deal
>in the Software without restriction, including without limitation the rights
>to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
>copies of the Software, and to permit persons to whom the Software is
>furnished to do so, subject to the following conditions:
>
>The above copyright notice and this permission notice shall be included in
>all copies or substantial portions of the Software.
>
>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
>IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
>FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
>AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
>LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
>OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
>THE SOFTWARE.
