'use strict';
const mathjax = require('mathjax-node');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require("path");
const mime = require("mime-types");
const fs = require('fs');
const http = require('http');

var args = require('minimist')(process.argv.slice(2));
const enableBrotli = args.enableBrotli || false;
const compress = args.compress || false;
const timeout = args.timeout || 5000;
const enableCache = args.enableCache || false;
var cacheSvg = args.cacheSvg || enableCache;
cacheSvg = cacheSvg == "false" ? false : cacheSvg;
var cachePng = args.cachePng || enableCache;
cachePng = cachePng == "false" ? false : cachePng;
var cacheGzip = args.cacheGzip || enableCache;
cacheGzip = cacheGzip == "false" ? false : cacheGzip;
var cacheDeflate = args.cacheDeflate || enableCache;
cacheDeflate = cacheDeflate == "false" ? false : cacheDeflate;
var cacheBrotli = args.cacheBrotli || enableCache;
cacheBrotli = cacheBrotli == "false" ? false : cacheBrotli;

if (compress)
    var zlib = require('zlib');
if (enableBrotli)
    var brotli = require('brotli');

const cache = "./cache/";
if (!fs.existsSync(cache))
    fs.mkdirSync(cache);

const webPath = "./www";

const port = args.port || process.env.PORT || 80;
const sslPort = args.sslPort || process.env.SSLPORT || 443;
var enableSSL = args.enableSSL || false;

if (enableSSL) {
    var keyFile = args.keyPath || process.env.keyPath;
    var certFile = args.certPath || process.env.certPath;
    if (keyFile && certFile && fs.existsSync(keyFile) && fs.existsSync(certFile)) {
        var https = require('https');
    } else
        enableSSL = false;
}

String.prototype.replaceAll = function (s1, s2) {
    return this.replace(new RegExp(s1, "gm"), s2);
}

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
    if (path != null &&fs.existsSync(path))
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
                return resolve(data.svg);
            }
            resolve(null);
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

function doBrotli(buffer, cacheFile, mode) {
    return new Promise(resolve => {
        try {
            let encoded = brotli.compress(buffer, {
                mode: mode, // 0 = generic, 1 = text, 2 = font (WOFF2)
                quality: 11, // 0 - 11
                lgwin: 22 // window size
            });
            if (encoded != null) {
                let data = Buffer.from(encoded.buffer);
                if (cacheFile != null)
                    fs.writeFileSync(cacheFile, data);
                return resolve(data);
            }
        } catch (ex) {
        }
        resolve(null);
    });
}

function doZlib(buffer, cacheFile, doCompress) {
    return new Promise(resolve => {
        doCompress(buffer, function (err, encoded) {
            if (err == null && encoded != null) {
                if (cacheFile != null)
                    fs.writeFileSync(cacheFile, encoded);
                return resolve(encoded);
            }
            resolve(null);
        });
    });
}

function doHttp(url, encoding,res) {
    let filePath = decodeURIComponent(url);
    let type = filePath.indexOf("?");
    if (type > 1) {
        filePath = filePath.substr(1, type - 1);
    }
    if (filePath.endsWith("/") || filePath == "") {
        filePath += "index.html";
    }
    type = filePath.lastIndexOf(".");
    if (type == -1)
        type = ".";
    else
        type = filePath.substr(type, filePath.length - type);
    let p = path.join(__dirname, webPath + filePath);
    res.setHeader("Content-Type",mime.lookup(type));
    fs.access(p, err => {
        if (err) return res.end("Not Found");
        let rs = fs.createReadStream(p);
        if (compress && encoding && encoding.match(/\bgzip\b/)) {
            res.setHeader("Content-Encoding", "gzip");
            return rs.pipe(zlib.createGzip()).pipe(res);
        } else if (compress && encoding && encoding.match(/\bdeflate\b/)) {
            res.setHeader("Content-Encoding", "deflate");
            return rs.pipe(zlib.createDeflate()).pipe(res);
        }
        return rs.pipe(res);
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
    } else if (req.url != null && req.url.endsWith(".png")) {
        tex = decodeURIComponent(req.url.substr(1, req.url.length - 5));
        type = ".png";
        tex = tex.replaceAll('/', '\\');
    } else if (req.url != null && req.url.endsWith(".svg")) {
        tex = decodeURIComponent(req.url.substr(1, req.url.length - 5));
        type = ".svg";
        tex = tex.replaceAll('/', '\\');
    } else
        return doHttp(req.url, req.headers["accept-encoding"], res);
    let data = null;
    let supportGzip = false;
    let supportDeflate = false;
    let supportBrotli = false;
    let gzipFile = null;
    let deflateFile = null;
    let brotliFile = null;
    if (tex != null && type != null) {
        if (compress && type == ".svg") {
            let encoding = req.headers["accept-encoding"];
            if (encoding && encoding.match(/\bgzip\b/))
                supportGzip = true;
            if (encoding && encoding.match(/\bdeflate\b/))
                supportDeflate = true;
            if (enableBrotli && encoding && encoding.match(/\bbr\b/))
                supportBrotli = true;
        }
        let md5 = null;
        if (supportBrotli && cacheBrotli) {
            md5 = getCacheName(tex);
            brotliFile = cache + md5 + type + ".br";
            encoded = loadFile(brotliFile);
            if (encoded != null)
                compressType = "br";
        }
        if (encoded == null && supportGzip && cacheGzip) {
            if (md5 == null)
                md5 = getCacheName(tex);
            gzipFile = cache + md5 + type + ".gz";
            encoded = loadFile(gzipFile);
            if (encoded != null)
                compressType = "gzip";
        }
        if (encoded == null && supportDeflate && cacheDeflate) {
            if (md5 == null)
                md5 = getCacheName(tex);
            deflateFile = cache + md5 + type + ".de";
            encoded = loadFile(deflateFile);
            if (encoded != null)
                compressType = "deflate";
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
        return res.end();
    }
    res.statusCode = 200;
    if (encoded == null && supportBrotli) {
        encoded = await timeoutPromise(doBrotli(data, brotliFile, 0), timeout);
        compressType = "br";
    }
    if (encoded == null && supportGzip) {
        encoded = await timeoutPromise(doZlib(data, gzipFile, zlib.gzip), timeout);
        compressType = "gzip";
    }
    if (encoded == null && supportDeflate) {
        encoded = await timeoutPromise(doZlib(data, deflateFile, zlib.deflate), timeout);
        compressType = "deflate";
    }
    res.setHeader('Content-Type', mime.lookup(type));
    if (data == null || (encoded != null && encoded.length < data.length)) {
        res.setHeader("Content-Encoding", compressType);
        return res.end(encoded);
    }
    res.end(data);
}

if (enableSSL) {
    https.createServer({
        key: fs.readFileSync(keyFile),
        cert: fs.readFileSync(certFile)
    }, function (req, res) {
        try {
            runMathjax(req, res);
        } catch (ex) {
            res.statusCode = 405;
            res.end();
        }
    }).listen(sslPort);
}
http.createServer(function (req, res) {
    try {
        runMathjax(req, res);
    } catch (ex) {
        res.statusCode = 405;
        res.end();
    }
}).listen(port);

