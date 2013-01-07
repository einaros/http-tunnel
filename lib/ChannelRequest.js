var util = require('util')
  , events = require('events');
module.exports = ChannelRequest;

function ChannelRequest(channel) {
  this._channel = channel;
  this._paused = 0;
  this.readable = true;
  this.writable = true;

  var originalEmit = this.emit;
  var self = this;
  this.emit = function(evt, data) {
    if (evt == 'data') {
      if (self._paused > 0) {
        self._buffered.push(new Buffer(data));
      }
      else {
        if (self._encoding) data = data.toString(self._encoding);
        originalEmit.call(self, 'data', data);
      }
    }
    else originalEmit.apply(this, arguments);
  }
  this.on('connect', function() {
    self.readable = true;
    self.writable = true;
  });
  this.on('data', function(data) {
    if (self.ondata) self.ondata(data, 0, data.length);
    for (var i = 0, l = self._pipes.length; i < l; ++i) {
      var pipe = self._pipes[i];
      pipe.write(data);
    }
  });
}

util.inherits(ChannelRequest, events.EventEmitter);

ChannelRequest.prototype.write = function(data, encoding, callback) {
  if (!this.writable) throw new Exception('Write after closed attempted');
  return this._channel.write(data, encoding, callback);
}

ChannelRequest.prototype.end = function(data, encoding) {
  this.readable = false;
  this.writable = false;
  this._channel = null;
  return;
}

ChannelRequest.prototype.destroy = function() {
  this.readable = false;
  this.writable = false;
  var channel = this._channel;
  this._channel = null;
  return channel.destroy();
}

ChannelRequest.prototype.setEncoding = function(encoding) {
  this._encoding = encoding;
}

ChannelRequest.prototype.pipe = function(target) {
  this._pipes.push(target);
}

ChannelRequest.prototype.setTimeout = function() {}

ChannelRequest.prototype.pause = function() {
  this._paused += 1;
}

ChannelRequest.prototype.resume = function() {
  if (this._paused > 0) {
    if (--this._paused > 0) return;
    var buffers = this._buffered;
    this._buffered = [];
    for (var i = 0, l = buffers.length; i < l; ++i) {
      var buf = buffers[i];
      this.emit('data', buf);
    }
  }
}
