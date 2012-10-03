var util = require('util')
  , events = require('events');
module.exports = StreamParser;

function StreamParser(readableStream) {
  this.stream = readableStream;
  this.dataBuffers = [];
  this.bytesToRead = 0;
  this.emitIncomplete = false;
  this.callbacks = [];
  var self = this;
  this.stream.on('data', function(data) {
    self.dataBuffers.push(data);
    self.parse();
  });
  process.nextTick(this.emit.bind(this, 'reader queue empty'));
}

util.inherits(StreamParser, events.EventEmitter);

StreamParser.prototype.read = function(length, emitIncomplete, callback) {
  if (length == 0) {
    callback(new Buffer(0));
  }
  else {
    this.bytesToRead = length;
    this.emitIncomplete = emitIncomplete;
    this.callbacks.push(callback);
    this.parse();
  }
}

StreamParser.prototype.discard = function(length) {
  this.read(length, false, function() {});
}

StreamParser.prototype.parse = function() {
  while (this.dataBuffers.length > 0 && this.callbacks.length > 0) {
    callback = this.callbacks[this.callbacks.length - 1];
    var dataBuffer = this.dataBuffers.shift();
    dataBuffer = new Buffer(dataBuffer);
    var toRead = Math.min(this.bytesToRead, dataBuffer.length);
    var data = dataBuffer.slice(0, toRead);
    if (dataBuffer.length > toRead) this.dataBuffers.unshift(dataBuffer.slice(toRead));
    this.bytesToRead -= toRead;
    if (this.bytesToRead == 0) this.callbacks.pop();
    if ((this.bytesToRead == 0 || this.emitIncomplete) && data.length > 0) callback(data);
  }
  if (this.callbacks.length == 0) this.emit('reader queue empty');
}
