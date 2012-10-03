#!/usr/bin/env node

var http = require('http')
  , events = require('events')
  , net = require('net')
  , util = require('util')
  , program = require('commander')
  , winston = require('winston')
  , Multiplexer = require('./Multiplexer');

program
  .option('-i, --ip [ip]', 'The port to listen on (default: 0.0.0.0)', '0.0.0.0')
  .option('-p, --port [port]', 'The port to listen on (default: 8080)', 8080)
  .option('--pass [pwd]', 'A password to require from clients [optional]')
  .option('-r, --ratelimit [kBps]', 'Limit the server rate to the specified kilobytes per second [optional]')
  .parse(process.argv);

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ timestamp: true }),
    new (winston.transports.File)({ filename: 'http-tunnel-server.log', timestamp: true })
  ]
});

process.on('uncaughtException', function(error) {
  logger.error('Uncaught error', { info: error, stack: error.stack });
});

function processIncomingRequest(socket) {
  var srv = new events.EventEmitter();
  srv.addListener('request', onHttpRequest.bind(this, socket));
  srv.addListener('upgrade', onHttpUpgrade);
  http._connectionListener.call(srv, socket);
}

function getRandomHostId() {
  return Math.abs(~~(Date.now() / Math.random()) + ~~(Math.random() * 999999)).toString(36);
}

function onHttpRequest(socket, req, res) {
  var handler = null;
  var host = req.headers['host'];
  if (host) handler = handlers[host];
  if (handler) pipeHttpRequestToHandler(handler, req, socket);
  else {
    logger.warning('Unhandled request', { method: req.method, url: req.url, host: host });
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('');
  }
}

function onHttpUpgrade(req, socket, upgradeHead) {
  var handler = null;
  var host = req.headers['host'];
  if (host) handler = handlers[host];
  if (handler) pipeHttpRequestToHandler(handler, req, socket);
  else initializeHandler(req, socket, upgradeHead);
}

function initializeHandler(req, socket, upgradeHead) {
  var upgrade = req.headers['upgrade'];
  if (!upgrade || upgrade != 'http-tunnel') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  var host = req.headers['host'];
  if (!host) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  var remoteHost = req.headers['x-forwarded-for'];

  if (program.pass &&
      (!req.headers['password'] ||
       req.headers['password'] != program.pass)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    logger.warning('Handler rejected due to invalid or missing password', { remote: remoteHost });
    return;
  }

  var handlerId;
  if (req.headers['preferredid']) {
    var preferredId = req.headers['preferredid'].replace(/[^A-z0-9\-.]/g, '');
    var tempId = preferredId + '.' + host;
    if (!handlers[tempId]) handlerId = tempId;
  }
  if (!handlerId) handlerId = getRandomHostId() + '.' + host;

  logger.info('Handler connected', { id: handlerId, remote: remoteHost });
  if (program.ratelimit) require('ratelimit')(socket, program.ratelimit * 1024, true);
  handlers[handlerId] = new Multiplexer(socket);
  socket.on('end', function() {
    handlers[handlerId] = null;
    logger.info('Handler disconnected', { id: handlerId, remote: remoteHost });
  });
  socket.write('HTTP/1.1 101 You are aweome!\r\n' +
               'Connection: Upgrade\r\n' +
               'Upgrade: http-tunnel\r\n' +
               'Host: ' + handlerId + '\r\n' +
               '\r\n');
}

function pipeHttpRequestToHandler(handler, req, socket) {
  handler.connect(function(error, channel) {
    var toSend = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
    for (var headerName in req.headers) {
      toSend += headerName + ': ' + req.headers[headerName] + '\r\n';
    }
    toSend += '\r\n';
    channel.write(toSend);
    req.pipe(channel);
    channel.pipe(socket);
  });
}

var handlers = {};
var server = net.createServer(processIncomingRequest);
server.listen(program.port, program.ip, function() {
  logger.info('Server listening', { ip: program.ip, port: program.port });
});

