#!/usr/bin/env node

var http = require('http')
  , https = require('https')
  , express = require('express')
  , events = require('events')
  , net = require('net')
  , util = require('util')
  , path = require('path')
  , program = require('commander')
  , Multiplexer = require('./Multiplexer');

process.on('uncaughtException', function(error) {
  console.log('Uncaught error: ', error, error.stack);
});

program
  .option('--server [addr]', 'The server address to connect to.')
  .option('--pass [uri]', 'A password to send to the server to authorize binding [optional]')
  .option('-s, --serve', 'Serve the current path')
  .option('-d, --directory', 'Enable directory browsing (used with -s)')
  .option('-p, --proxy [port]', 'Proxy connections to port')
  .option('-i, --id [id]', 'The preferred id to request the server to bind to [optional]')
  .parse(process.argv);

if (!program.server) {
  console.log('Provide a server address to --server. Try --help.');
  process.exit(-1);
}
if ((!program.serve && !program.proxy) || (program.serve && program.proxy)) {
  console.log('Provide either -s/--serve or -p/--proxy. Try --help.');
  process.exit(-1);
}

var webserver;
if (program.serve) {
  webserver = express();
  webserver.all('*', function(req, res, next) {
    var clientAddress = req.headers['x-forwarded-for'];
    if (clientAddress) console.log('Request from %s: %s %s', clientAddress, req.method, req.originalUrl);
    else console.log('Request: %s %s', req.method, req.originalUrl);
    return next();
  });
  if (program.directory) webserver.use(express.directory(process.cwd()));
  webserver.use(express.static(process.cwd()));
}

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
  var options = {
    port: 443,
    host: host,
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'http-tunnel'
    }
  };
  if (program.id) options.headers['preferredid'] = program.id;
  if (program.pass) options.headers['password'] = program.pass;
  var req = https.request(options);
  req.on('upgrade', function(res, socket, upgradeHead) {
    callback(socket, res.headers['host']);
  });
  req.on('response', function(res) {
    console.log('Connection failed: HTTP %s', res.statusCode);
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

bindWithServer(program.server, nextTick(function(socket, host) {
  copyToClipboard(host);
  console.log('Bound at address: ' + host);
  delete socket._httpMessage; // not properly cleaned up after UPGRADE/Connect
  var mpx = new Multiplexer(socket);
  mpx.listen(function(error, channel) {
    if (program.proxy) {
      channel.pause();
      var proxy = net.connect({port: program.proxy}, function() {
        channel.pipe(proxy);
        proxy.pipe(channel);
        channel.resume();
      });
      proxy.on('end', function() {
        channel.end();
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
