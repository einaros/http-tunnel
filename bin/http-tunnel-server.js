#!/usr/bin/env node

var http = require('http')
  , events = require('events')
  , net = require('net')
  , util = require('util')
  , program = require('commander')
  , winston = require('winston')
  , ChannelRequest = require('../lib/ChannelRequest')
  , Multiplexer = require('../lib/Multiplexer');

program
  .option('-i, --ip [ip]', 'The port to listen on (default: 0.0.0.0)', '0.0.0.0')
  .option('-p, --port [port]', 'The port to listen on (default: 8080)', 8080)
  .option('-d, --domain [address]', 'The domain to bind clients to. E.g. "foo.com" will cause clients to bind to "clientid.foo.com"')
  .option('--securable', 'Indicate to clients that they can serve secure content (e.g. https://clientid.foo.com)')
  .option('--pass [pwd]', 'A password to require from clients [optional]')
  .option('-r, --ratelimit [kBps]', 'Limit the server rate to the specified kilobytes per second [optional]')
  .option('-l, --log', 'Log requests passing through the channel [optional]')
  .parse(process.argv);

if (!program.domain) {
  console.log('Provide a domain with -d/--domain. Try --help.');
  process.exit(-1);
}

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ timestamp: true, colorize: true }),
    new (winston.transports.File)({ filename: 'http-tunnel-server.log', timestamp: true, json: false })
  ]
});
var requestLogger = new (winston.Logger)({
  transports: [
    new (winston.transports.File)({ filename: 'http-tunnel-server-requests.log', timestamp: true, json: false })
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
  if (handler) pipeHttpRequestToHandler(handler, req, socket, host);
  else {
    logger.warn('Unhandled request', { method: req.method, url: req.url, host: host });
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('');
  }
}

function onHttpUpgrade(req, socket, upgradeHead) {
  var handler = null;
  var host = req.headers['host'];
  if (host) handler = handlers[host];
  if (handler) pipeHttpRequestToHandler(handler, req, socket, host);
  else initializeHandler(req, socket, upgradeHead);
}

function initializeHandler(req, socket, upgradeHead) {
  var upgrade = req.headers['upgrade'];
  if (!upgrade || upgrade != 'http-tunnel') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  var forwardedFor = req.headers['x-forwarded-for'];

  if (program.pass &&
      (!req.headers['password'] ||
       req.headers['password'] != program.pass)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    logger.warning('Handler rejected due to invalid or missing password', { remote: forwardedFor });
    return;
  }

  var handlerId;
  if (req.headers['preferredid']) {
    var preferredId = req.headers['preferredid'].replace(/[^A-z0-9\-.]/g, '') + '.' + program.domain;
    if (!handlers[preferredId]) handlerId = preferredId;
  }
  if (!handlerId) handlerId = getRandomHostId() + '.' + program.domain;

  logger.info('Handler connected', { id: handlerId, remote: forwardedFor });
  if (program.ratelimit) require('ratelimit')(socket, program.ratelimit * 1024, true);
  handlers[handlerId] = new Multiplexer(socket);

  function onSocketClose() {
    if (!handlers[handlerId]) return;
    handlers[handlerId] = null;
    logger.info('Handler disconnected', { id: handlerId, remote: forwardedFor });
  }

  socket.on('end', onSocketClose);
  socket.on('close', onSocketClose);
  socket.write('HTTP/1.1 101 You are aweome!\r\n' +
               'Connection: Upgrade\r\n' +
               'Upgrade: http-tunnel\r\n' +
               'Host: ' + (program.securable ? 'https://' : 'http://') + handlerId + '\r\n' +
               '\r\n');
}

function pipeHttpRequestToHandler(handler, req, clientSocket, host) {
  // forward client ip
  var forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) clientSocket.forwardedFor = forwardedFor;
  else if (clientSocket.forwardedFor) {
    forwardedFor = clientSocket.forwardedFor;
    req.headers['x-forwarded-for'] = forwardedFor;
  }

  // log request, if requested
  if (program.log) requestLogger.info(req.method, { url: req.url, host: host, remote: forwardedFor });

  function sendRequestToHandler(handlerChannel) {
    // reuse channel
    var toSend = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
    for (var headerName in req.headers) {
      toSend += headerName + ': ' + req.headers[headerName] + '\r\n';
    }
    toSend += '\r\n';
    handlerChannel.write(toSend);
    req.pipe(new ChannelRequest(handlerChannel)); // pipe request from client to handler
  }

  if (clientSocket._handlerChannel) {
    var handlerChannel = clientSocket._handlerChannel;
    sendRequestToHandler(handlerChannel);
  }
  else {
    // pipe the connection through
    handler.connect(function(error, handlerChannel) {
      if (error) {
        logger.error('Error while making new connection to handler.', { host: host });
        clientSocket.destroy();
        return;
      }
      // Ensure that the handler channel and client socket mutually end
      handlerChannel.on('end', function() {
        clientSocket._handlerChannel = null;
        clientSocket.end();
      });
      clientSocket.on('end', function() {
        try {
          handlerChannel.end();
        }
        catch (e) {
          // might already be closed, so ignore the error
        }
      });
      clientSocket._handlerChannel = handlerChannel;
      handlerChannel.pipe(clientSocket); // pipe data from handler to client
      sendRequestToHandler(handlerChannel);
    });
  }
}

var handlers = {};
var server = net.createServer(processIncomingRequest);
server.listen(program.port, program.ip, function() {
  logger.info('Server listening', { ip: program.ip, port: program.port });
});

