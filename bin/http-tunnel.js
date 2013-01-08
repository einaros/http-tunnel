#!/usr/bin/env node

var http = require('http')
  , https = require('https')
  , express = require('express')
  , events = require('events')
  , net = require('net')
  , util = require('util')
  , path = require('path')
  , program = require('commander')
  , winston = require('winston')
  , Multiplexer = require('../lib/Multiplexer');

program
  .option('--server [addr]', 'The server address to connect to.')
  .option('--pass [password]', 'A password to send to the server to authorize binding [optional]')
  .option('--no-ssl', 'Don\'t use ssl for http-tunnel-server connection.')
  .option('-s, --serve', 'Serve the current path.')
  .option('-d, --directory', 'Enable directory browsing (used with -s)')
  .option('-p, --proxy [[address:]port]', 'Proxy connections to port')
  .option('-i, --id [id]', 'The preferred id to request the server to bind to [optional]')
  .option('-r, --ratelimit [kBps]', 'Limit the server rate to the specified kilobytes per second [optional]')
  .parse(process.argv);

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ timestamp: true, colorize: true })
  ]
});

if (!program.server) {
  console.log('Provide a server address to --server. Try --help.');
  process.exit(-1);
}
if ((!program.serve && !program.proxy) || (program.serve && program.proxy)) {
  console.log('Provide either -s/--serve or -p/--proxy. Try --help.');
  process.exit(-1);
}
var useSSL = true;
if (program.ssl == false) useSSL = false;

process.on('uncaughtException', function(error) {
  logger.error('Uncaught error', { info: error, stack: error.stack });
});

function copyToClipboard(str, cb) {
  var spawn = require('child_process').spawn
    , pbcopy = spawn('pbcopy');
  pbcopy.on('exit', function (code) {
    if (cb) cb(code == 0);
  });
  pbcopy.stdin.write(str + '\n');
  pbcopy.stdin.end();
}

function bindWithServer(host, callback) {
  var port = useSSL ? 443 : 80;
  if (host.indexOf(':') != -1) {
    var hostParts = host.split(':');
    host = hostParts[0];
    port = hostParts[1];
  }
  var options = {
    port: port,
    host: host,
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'http-tunnel'
    },
    rejectUnauthorized: true
  };
  if (program.id) options.headers['preferredid'] = program.id;
  if (program.pass) options.headers['password'] = program.pass;
  var req = (useSSL ? https : http).request(options);
  req.on('upgrade', function(res, socket, upgradeHead) {
    callback(socket, res.headers['host']);
  });
  req.on('response', function(res) {
    logger.error('Connection failed: HTTP ' + res.statusCode);
    process.exit(-1);
  })
  req.end();
}

function nextTick(cb) {
  return (function() {
    var args = arguments;
    process.nextTick(function() {
      cb.apply(this, args);
    });
  }).bind(this);
}

var webserver;
if (program.serve) {
  webserver = express();
  webserver.all('*', function(req, res, next) {
    var clientAddress = req.headers['x-forwarded-for'];
    if (clientAddress) logger.info(util.format('Request from %s: %s %s', clientAddress, req.method, req.originalUrl));
    else logger.info(util.format('Request: %s %s', req.method, req.originalUrl));
    return next();
  });
  if (program.directory) webserver.use(express.directory(process.cwd()));
  webserver.use(express.static(process.cwd()));
}

bindWithServer(program.server, nextTick(function(socket, address) {
  if (program.ratelimit) require('ratelimit')(socket, program.ratelimit * 1024, true);
  copyToClipboard(address);
  logger.info('Secure connection established with tunnel server.');
  logger.info(util.format('Serving content through: %s', address));
  delete socket._httpMessage; // not properly cleaned up after UPGRADE/Connect in node.js core
  var mpx = new Multiplexer(socket);
  mpx.listen(function(error, channel) {
    if (program.proxy) {
      var proxyHost = '127.0.0.1';
      var proxyPort = program.proxy;
      if (program.proxy.indexOf(':') != -1) {
        var hostParts = program.proxy.split(':');
        proxyHost = hostParts[0];
        proxyPort = hostParts[1];
      }
      logger.info(util.format('Proxying incoming request to %s:%s', proxyHost, proxyPort));
      channel.pause();
      var proxy = net.connect({host: proxyHost, port: proxyPort}, function() {
        channel.pipe(proxy);
        proxy.pipe(channel);
        channel.resume();
      });
      proxy.on('error', function(error) {
        logger.error('Error connecting to proxy host.', { info: error, stack: error.stack });
        try {
          handlerChannel.end();
        }
        catch (e) {/* ignore */ }
      });
      proxy.on('end', function() {
        try {
          handlerChannel.end();
        }
        catch (e) {/* ignore */ }
      });
      channel.on('end', function() {
        proxy.end();
      });
    }
    else {
      var handler = new events.EventEmitter();
      handler.addListener('request', webserver);
      http._connectionListener.call(handler, channel);
    }
  });
}));
