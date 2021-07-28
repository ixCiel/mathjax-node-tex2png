'use strict';
const http = require('http');
const mathjax = require('mathjax-node');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');

const timeout = 5000;
const cacheSvg = true;
const cachePng = true;
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

async function runMathjax(req, res) {
    var type = null;
    var tex = null;
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
    var code = 200;
    var ct = 'image/png';
    var data = null;
    if (tex != null && type != null) {
        var md5 = null;
        var svgFile = null;
        var pngFile = null;
        if (cacheSvg) {
            md5 = getCacheName(tex);
            svgFile = cache + md5 + ".svg";
        }
        if (cachePng) {
            if (md5 == null)
                md5 = getCacheName(tex);
            pngFile = cache + md5 + ".png";
        }
        if (type == ".png")
            data = loadFile(pngFile);
        if (data == null) {
            data = loadFile(svgFile);
            if (data == null)
                data = await timeoutPromise(tex2svg(tex, svgFile), timeout);
            if (type == ".png")
                data = await timeoutPromise(tex2png(data, pngFile), timeout);
        }
    }
    if (data == null) {
        data = 'error';
        code = 404;
        ct = 'text/plain';
    } else if (type == ".svg")
        ct = 'text/xml';
    res.writeHead(code, { 'Content-Type': ct });
    res.end(data);
}

http.createServer(function (req, res) {
    try {
        runMathjax(req, res);
    } catch (ex) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('error\n' + ex);
    }
}).listen(port);
