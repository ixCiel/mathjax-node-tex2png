# mathjax-node-tex2png

提供web服务，tex通过mathjax-node生成公式，返回svg或者png

--compress		启用gzip、deflate压缩
--enableBrotli	启用Brotli压缩
--enableCache	启用所有cache
--cacheSvg		启用svgCache
--cachePng		启用pngCache
--cacheGzip		启用gzipCache
--cacheDeflate	启用deflateCache
--cacheBrotli	启用brotliCache
--timeout 5000	超时时间（毫秒）
--port 80		使用端口（默认80）
--enableSSL		启用ssl
--sslPort 443	ssl所使用的端口（默认443）
--keyPath		ssl的key文件
--certPath		ssl的cert文件

for example:
node server.js --compress --enableBrotli --enableCache --enableSSL --keyPath /cert/privkey.pem --certPath /cert/fullchain.pem

for systemd:
[Unit]
Description=Mathjax-node-tex2png
[Service]
WorkingDirectory= /var/mathjax-node-tex2png
ExecStart= /usr/bin/node /var/mathjax-node-tex2png/server.js --enableBrotli --compress --enableCache --enableSSL --keyPath /cert/privkey.pem --certPath /cert/fullchain.pem
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target

for certbot
certbot certonly --webroot -w /var/mathjax-node-tex2png/www/ -d your.domain.xxx

Demo:
https://mathjax.ixsoleil.cf/tex2svg?tex=f(x_1,x_2,\ldots,x_n)=x_1^2+x_2^2+\cdots+x_n^2
https://mathjax.ixsoleil.cf/tex2png?tex=f(x_1,x_2,\ldots,x_n)=x_1^2+x_2^2+\cdots+x_n^2
https://mathjax.ixsoleil.cf/f(x_1,x_2,\ldots,x_n)=x_1^2+x_2^2+\cdots+x_n^2.svg
https://mathjax.ixsoleil.cf/f(x_1,x_2,\ldots,x_n)=x_1^2+x_2^2+\cdots+x_n^2.png