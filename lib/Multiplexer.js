var util = require('util')
  , events = require('events')
  , StreamParser = require('./lib/StreamParser')
  , Channel = require('./lib/Channel');
module.exports = Multiplexer;

function Multiplexer(socket) {
  this.controlCodes = {
    connect: { code: 0x1, handler: this._handleConnect.bind(this) },
    ackConnect: { code: 0x2, handler: this._handleAckConnect.bind(this) },
    synConnect: { code: 0x3, handler: this._handleSynConnect.bind(this) },
    disconnect: { code: 0x4, handler: this._handleDisconnect.bind(this) },
    ping: { code: 0x5, handler: this._handlePing.bind(this) },
    pong: { code: 0x6, handler: this._handlePong.bind(this) },
  };
  for (var name in this.controlCodes) {
    this.controlCodes[this.controlCodes[name].code] = this.controlCodes[name].handler;
  }

  this.connected = true;
  this.socket = socket;
  socket.setNoDelay(true);
  this.sessions = {};
  this.refCounter = 0;
  var activeChannel;
  var parser = new StreamParser(socket);
  var self = this;
  parser.on('reader queue empty', function() {
    parser.read(4, false, function(data) {
      var first = data.readUInt16BE(0);
      var length = data.readUInt16BE(2);
      var ref = (first & ~0x8000);
      if (first & 0x8000) {
        var code = length >> 8;
        var length = length & 0xFF; // currently not used, as control send no payload
        // parser.read(length, false, function(data) {
        // console.log('Control code: %d, ref: %d', code, ref);
        var handler = self.controlCodes[parseInt(code)];
        if (handler) handler(ref);
        // }
      }
      else {
        parser.read(length, true, function(data) {
          var session = self.sessions[ref];
          if (session && session.channel) {
            session.channel.emit('data', data);
          }
        });
      }
    });
  });

  this.pingFrequency = 10000;
  setTimeout(this._sendControlPacket.bind(this, this.controlCodes.ping, 0), this.pingFrequency);
  socket.on('end', function() {
    this.connected = false;
    for (var key in self.sessions) {
      if (!self.sessions.hasOwnProperty(key)) continue;
      self._handleDisconnect(key);
    }
  });
}

/**
 * Public API
 */

Multiplexer.prototype.listen = function(callback) {
  this.listener = callback;
}

Multiplexer.prototype.connect = function(callback) {
  var ref = this._getNextRef();
  this.sessions[ref] = {
    onConnect: callback
  };
  this._sendControlPacket(this.controlCodes.connect, ref);
}

/**
 * Private API
 */

Multiplexer.prototype._handleConnect = function(ref) {
  // received by the listener
  if (this.listener) {
    this.sessions[ref] = { };
    var channel = this._makeChannel(ref);
    channel.pause();
    // todo: set timeout to tear down the channel
    this._sendControlPacket(this.controlCodes.ackConnect, ref);
  }
  else {
    this._sendControlPacket(this.controlCodes.disconnect, ref);
  }
}

Multiplexer.prototype._handleAckConnect = function(ref) {
  // received by the connecting party
  var session = this.sessions[ref];
  if (session) {
    var self = this;
    if (session.channel) throw new Exception('session already has a channel');
    self._makeChannel(ref);
    var onConnect = session.onConnect;
    delete session.onConnect;
    session.channel.emit('connect');
    onConnect(null, session.channel);
    self._sendControlPacket(self.controlCodes.synConnect, ref);
  }
  else {
    this._sendControlPacket(this.controlCodes.disconnect, ref);
  }
}

Multiplexer.prototype._handleSynConnect = function(ref) {
  // received by the listener
  if (this.listener) {
    var session = this.sessions[ref];
    if (session) {
      session.channel.emit('connect');
      this.listener(null, session.channel);
      session.channel.resume();
    }
    else {
      // no such session
      this._sendControlPacket(this.controlCodes.disconnect, ref);
    }
  }
  else {
    // invalid syn - no listener
    this._sendControlPacket(this.controlCodes.disconnect, ref);
  }
}

Multiplexer.prototype._handleDisconnect = function(ref) {
  var session = this.sessions[ref];
  if (session) {
    if (session.channel) {
      session.channel.emit('end');
      session.channel.emit('close');
    }
    if (session.onConnect) {
      session.onConnect(new Error('disconnected during connection attempt'));
    }
    delete this.sessions[ref];
  }
}

Multiplexer.prototype._handlePing = function(ref) {
  this._sendControlPacket(this.controlCodes.pong, ref);
}

Multiplexer.prototype._handlePong = function(ref) {
  setTimeout(this._sendControlPacket.bind(this, this.controlCodes.ping, 0), this.pingFrequency);
}

Multiplexer.prototype._getNextRef = function() {
  var ref = this.refCounter;
  this.refCounter += 1;
  if (this.refCounter > 32767) this.refCounter = 0;
  return ref;
}

Multiplexer.prototype._sendControlPacket = function(control, ref) {
  if (!this.connected) return;
  var data = new Buffer(4);
  data.writeUInt16BE(0x8000 | ref, 0); // control indicator + ref
  data.writeUInt8(control.code, 2);  // code
  data.writeUInt8(0, 3); // length, currently 0, but control packets *can* hold 256 bytes of data
  this.socket.write(data);
}

Multiplexer.prototype._sendThroughSession = function(ref, data, encoding, callback) {
  if (!this.connected) return;
  var session = this.sessions[ref];
  if (!session) throw new Error('Attempted write through closed channel');
  if (!data) return true;
  if (!Buffer.isBuffer(data)) data = new Buffer(data.toString(), encoding);
  if (data.length == 0) return true;

  var result = true;
  var offset = 0;
  while (true) {
    var pieceLength = Math.min(65535, data.length - offset);
    var outgoingData = new Buffer(4 + pieceLength);
    data.copy(outgoingData, 4, offset, offset + pieceLength);
    offset += pieceLength;
    outgoingData.writeUInt16BE(ref, 0);
    outgoingData.writeUInt16BE(pieceLength, 2);
    var lastPiece = pieceLength < 65535;
    result = this.socket.write(outgoingData, encoding, lastPiece ? callback : undefined);
    if (lastPiece) break;
  }
  if (result == false) this.socket.once('drain', session.channel.emit.bind(session.channel, 'drain'));
  return result;
}

Multiplexer.prototype._disconnectSession = function(ref) {
  this._sendControlPacket(this.controlCodes.disconnect, ref);
  this._handleDisconnect(ref);
}

Multiplexer.prototype._makeChannel = function(ref) {
  var channel = new Channel(this._sendThroughSession.bind(this, ref), this._disconnectSession.bind(this, ref));
  this.sessions[ref].channel = channel;
  return channel;
}
