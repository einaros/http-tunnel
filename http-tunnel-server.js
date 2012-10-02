#!/usr/bin/env node

var http = require('http')
  , events = require('events')
  , net = require('net')
  , util = require('util')
  , program = require('commander')
  , Multiplexer = require('./Multiplexer');

program
  .option('--pass [pwd]', 'A password to require from clients [optional]')
  .parse(process.argv);

process.on('uncaughtException', function(error) {
  console.log('Uncaught error: ', error, error.stack);
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
    console.log('Unhandled request: %s %s %s', req.method, req.url, host);
    res.writeHead(404, {'Content-Type': 'text/plain'});
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

  if (program.pass &&
      (!req.headers['password'] ||
       req.headers['password'] != program.pass)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    console.log('Handler rejected due to invalid or missing password.');
    return;
  }

  var handlerId;
  if (req.headers['preferredid']) {
    var preferredId = req.headers['preferredid'].replace(/[^A-z0-9\-.]/g, '');
    var tempId = preferredId + '.' + host;
    if (!handlers[tempId]) handlerId = tempId;
  }
  if (!handlerId) handlerId = getRandomHostId() + '.' + host;

  console.log('Handler connected: %s', handlerId);
  handlers[handlerId] = new Multiplexer(socket);
  socket.on('end', function() {
    handlers[handlerId] = null;
    console.log('Handler disconnected: %s', handlerId);
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
server.listen(4004, function() {
  console.log('Server listening.');
});

