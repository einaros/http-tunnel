var util = require('util')
  , events = require('events');
module.exports = Channel;

function Channel(sendData, disconnect) {
  this._sendData = sendData;
  this._disconnect = disconnect;
  this._encoding = null;
  this._paused = 0;
  this._pipes = [];
  this._buffered = [];
  this.readable = false;
  this.writable = false;

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

util.inherits(Channel, events.EventEmitter);

Channel.prototype.write = function(data, encoding, callback) {
  return this._sendData(data, encoding, callback);
}

Channel.prototype.end = function(data, encoding) {
  this._sendData(data, encoding);
  this.readable = false;
  this.writable = false;
  return this._disconnect();
}

Channel.prototype.destroy = function() {
  return this._disconnect();
}

Channel.prototype.setEncoding = function(encoding) {
  this._encoding = encoding;
}

Channel.prototype.pipe = function(target) {
  this._pipes.push(target);
}

Channel.prototype.setTimeout = function() {}

Channel.prototype.pause = function() {
  this._paused += 1;
}

Channel.prototype.resume = function() {
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
