'use strict';
const http = require('http');
const mathjax = require('mathjax-node');
const sharp = require('sharp');
const crypto = require('crypto');
const compress = true;
const timeout = 5000;
const cacheSvg = true;
const cachePng = true;
const cacheGzip = true;
const cacheDeflate = true;
if (compress)
    var zlib = require('zlib');
if (cacheSvg || cachePng || cacheGzip || cacheDeflate)
    var fs = require('fs');
const cache = "./cache/";
const port = process.env.PORT || 2082;

if (!fs.existsSync(cache))
    fs.mkdirSync(cache);

function getCacheName(tex) {
    return crypto.createHash('md5').update(tex).digest("hex");
}

function delayPromise(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function timeoutPromise(promise, ms) {
    return new Promise(resolve => {
        var timeout = delayPromise(ms).then(function () {
            resolve(null);
        });
        Promise.race([promise, timeout]).catch(function () {
            resolve(null);
        }).then(function (data) {
            resolve(data);
        });
    });
}

function loadFile(path) {
    if (path == null)
        return null;
    if (fs.existsSync(path))
        return fs.readFileSync(path);
    return null;
}

function tex2svg(tex, cacheFile) {
    return new Promise(resolve => {
        mathjax.typeset({
            math: tex,
            format: "TeX",
            svg: true,
        }, function (data) {
            if (!data.errors) {
                if (cacheFile != null)
                    fs.writeFileSync(cacheFile, data.svg);
                resolve(data.svg);
            } else {
                resolve(null);
            }
        });
    });
}

function tex2png(svg, cacheFile) {
    return new Promise(resolve => {
        if (svg == null) {
            resolve(null);
        } else {
            sharp(Buffer.from(svg)).png().toBuffer().then(function (data) {
                if (cacheFile != null && data != null)
                    fs.writeFileSync(cacheFile, data);
                resolve(data);
            }).catch(function () {
                resolve(null);
            });
        }
    });
}

function getTex(str) {
    if (str == null)
        return null;
    var s = str.indexOf("tex=");
    if (s == -1)
        return null;
    s += 4;
    var e = str.indexOf("&", s);
    if (e == -1)
        return decodeURIComponent(str.substr(s, str.length - s));
    return decodeURIComponent(str.substr(s, e - s));
}

function getDataTex(req) {
    return new Promise(resolve => {
        var body = "";
        var tex = null;
        req.on('data', function (chunk) {
            body += chunk;
        });
        req.on('end', function () {
            tex = getTex(body);
            resolve(tex);
        });
    });
}

function doZlib(buffer, cacheFile, doCompress) {
    return new Promise(resolve => {
        doCompress(buffer, function (err, encoded) {
            if (err == null && encoded != null) {
                if (cacheFile != null)
                    fs.writeFileSync(cacheFile, encoded);
                resolve(encoded);
            } else
                resolve(null);
        });
    });
}

async function runMathjax(req, res) {
    let type = null;
    let tex = null;
    let encoded = null;
    let compressType = null;
    if (req.url.startsWith("/tex2svg?")) {
        tex = getTex(req.url);
        type = ".svg";
    } else if (req.url.startsWith("/tex2png?")) {
        tex = getTex(req.url);
        type = ".png";
    } else if (req.url == "/tex2svg") {
        type = ".svg";
        tex = await timeoutPromise(getDataTex(req), timeout);
    } else if (req.url == "/tex2png") {
        type = ".png";
        tex = await timeoutPromise(getDataTex(req), timeout);
    }
    let data = null;
    let supportGzip = false;
    let supportDeflate = false;
    let gzipFile = null;
    let deflateFile = null;
    if (tex != null && type != null) {
        if (compress && type != ".png") {
            let encoding = req.headers["accept-encoding"];
            if (encoding && encoding.match(/\bgzip\b/)) {
                supportGzip = true;
            }
            if (encoding && encoding.match(/\bdeflate\b/)) {
                supportDeflate = true;
            }
        }
        let md5 = null;
        if (type == ".svg") {
            if (supportGzip && cacheGzip) {
                md5 = getCacheName(tex);
                gzipFile = cache + md5 + ".svg.gz";
                encoded = loadFile(gzipFile);
                if (encoded != null)
                    compressType = "gzip";
            }
            if (encoded == null && supportDeflate && cacheDeflate) {
                if (md5 == null)
                    md5 = getCacheName(tex);
                deflateFile = cache + md5 + ".svg.def.gz";
                encoded = loadFile(deflateFile);
                if (encoded != null)
                    compressType = "deflate";
            }
        }
        if (encoded == null) {
            let pngFile = null;
            if (type == ".png") {
                if (cachePng) {
                    if (md5 == null)
                        md5 = getCacheName(tex);
                    pngFile = cache + md5 + ".png";
                }
                data = loadFile(pngFile);
            }
            if (data == null) {
                let svgFile = null;
                if (cacheSvg) {
                    if (md5 == null)
                        md5 = getCacheName(tex);
                    svgFile = cache + md5 + ".svg";
                }
                data = loadFile(svgFile);
                if (data == null)
                    data = await timeoutPromise(tex2svg(tex, svgFile), timeout);
                if (type == ".png")
                    data = await timeoutPromise(tex2png(data, pngFile), timeout);
            }
        }
    }
    if (data == null && encoded == null) {
        res.statusCode = 405;
        res.end();
    } else {
        res.statusCode = 200;
        if (encoded == null && supportGzip) {
            encoded = await timeoutPromise(doZlib(data, gzipFile, zlib.gzip), timeout);
            compressType = "gzip";
        }
        if (encoded == null && supportDeflate) {
            encoded = await timeoutPromise(doZlib(data, deflateFile, zlib.deflate), timeout);
            compressType = "deflate";
        }
        if (type == ".svg")
            res.setHeader('Content-Type', 'text/xml');
        else
            res.setHeader('Content-Type', 'image/png');
        if (data == null || (encoded != null && encoded.length < data.length)) {
            res.setHeader("Content-Encoding", compressType);
            res.end(encoded);
        }
        else
            res.end(data);
    }
}

http.createServer(function (req, res) {
    try {
        res.setHeader('Connection', 'close');
        runMathjax(req, res);
    } catch (ex) {
        res.statusCode = 405;
        res.end();
    }
}).listen(port);
