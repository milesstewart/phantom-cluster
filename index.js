// Generated by CoffeeScript 1.6.3
(function() {
  var DEFAULT_MESSAGE_TIMEOUT, DEFAULT_WORKER_ITERATIONS, PhantomClusterClient, PhantomClusterServer, PhantomQueuedClusterClient, PhantomQueuedClusterServer, QueueItem, STOP_QUEUE_CHECKING_INTERVAL, cluster, create, createQueued, empty, events, phantom,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  phantom = require("phantom");

  cluster = require("cluster");

  events = require("events");

  DEFAULT_WORKER_ITERATIONS = 100;

  STOP_QUEUE_CHECKING_INTERVAL = 10;

  DEFAULT_MESSAGE_TIMEOUT = 60 * 1000;

  empty = function(obj) {
    var key;
    for (key in obj) {
      return false;
    }
    return true;
  };

  create = function(options) {
    if (cluster.isMaster) {
      return new PhantomClusterServer(options);
    } else {
      return new PhantomClusterClient(options);
    }
  };

  createQueued = function(options) {
    if (cluster.isMaster) {
      return new PhantomQueuedClusterServer(options);
    } else {
      return new PhantomQueuedClusterClient(options);
    }
  };

  PhantomClusterServer = (function(_super) {
    __extends(PhantomClusterServer, _super);

    function PhantomClusterServer(options) {
      if (options == null) {
        options = {};
      }
      PhantomClusterServer.__super__.constructor.apply(this, arguments);
      this.numWorkers = options.workers || require("os").cpus().length;
      this.workers = {};
      this.done = false;
    }

    PhantomClusterServer.prototype.addWorker = function() {
      var worker;
      worker = cluster.fork();
      this.workers[worker.id] = worker;
      return this.emit("workerStarted", worker);
    };

    PhantomClusterServer.prototype.start = function() {
      var i, _i, _ref,
        _this = this;
      cluster.on("exit", function(worker, code, signal) {
        _this.emit("workerDied", worker, code, signal);
        delete _this.workers[worker.id];
        if (!_this.done) {
          return _this.addWorker();
        }
      });
      for (i = _i = 0, _ref = this.numWorkers; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
        this.addWorker();
      }
      return this.emit("started");
    };

    PhantomClusterServer.prototype.stop = function() {
      var worker, _, _ref;
      if (!this.done) {
        this.done = true;
        _ref = this.workers;
        for (_ in _ref) {
          worker = _ref[_];
          worker.kill();
        }
        return this.emit("stopped");
      }
    };

    return PhantomClusterServer;

  })(events.EventEmitter);

  PhantomClusterClient = (function(_super) {
    __extends(PhantomClusterClient, _super);

    function PhantomClusterClient(options) {
      if (options == null) {
        options = {};
      }
      this._onExit = __bind(this._onExit, this);
      PhantomClusterClient.__super__.constructor.apply(this, arguments);
      this.ph = null;
      this.iterations = options.workerIterations || DEFAULT_WORKER_ITERATIONS;
      this.phantomArguments = options.phantomArguments || [];
      this.phantomBinary = options.phantomBinary || require("phantomjs").path;
      this.phantomBasePort = this.phantomBasePort || 12300;
      this.onStdout = options.onStdout;
      this.onStderr = options.onStderr;
      this.done = false;
      process.on("SIGTERM", this._onExit);
      process.on("SIGINT", this._onExit);
    }

    PhantomClusterClient.prototype.start = function() {
      var onStart, options,
        _this = this;
      options = {
        binary: this.phantomBinary,
        port: this.phantomBasePort + cluster.worker.id + 1,
        onStdout: this.onStdout,
        onStderr: this.onStderr,
        onExit: function() {
          _this.emit("phantomDied");
          return _this.stop();
        }
      };
      onStart = function(ph) {
        _this.ph = ph;
        _this.emit("phantomStarted");
        return _this.next();
      };
      phantom.create.apply(phantom, this.phantomArguments.concat([options, onStart]));
      return this.emit("started");
    };

    PhantomClusterClient.prototype.next = function() {
      if (!this.done) {
        this.iterations--;
        if (this.iterations >= 0) {
          return this.emit("workerReady");
        } else {
          return this.stop();
        }
      }
    };

    PhantomClusterClient.prototype.stop = function() {
      if (!this.done) {
        this.done = true;
        this.emit("stopped");
        return process.nextTick(function() {
          return process.exit(0);
        });
      }
    };

    PhantomClusterClient.prototype._onExit = function() {
      return process.exit();
    };

    return PhantomClusterClient;

  })(events.EventEmitter);

  PhantomQueuedClusterServer = (function(_super) {
    __extends(PhantomQueuedClusterServer, _super);

    function PhantomQueuedClusterServer(options) {
      this._onWorkerStarted = __bind(this._onWorkerStarted, this);
      PhantomQueuedClusterServer.__super__.constructor.call(this, options);
      this.messageTimeout = options.messageTimeout || DEFAULT_MESSAGE_TIMEOUT;
      this._sentMessages = {};
      this._messageIdCounter = 0;
      this.queue = [];
      this.clientsQueue = [];
      this.on("workerStarted", this._onWorkerStarted);
    }

    PhantomQueuedClusterServer.prototype.enqueue = function(request) {
      var item, sent,
        _this = this;
      item = new QueueItem(this._messageIdCounter++, request);
      request.id = item.id;
      item.on("timeout", function() {
        return delete _this._sentMessages[item.id];
      });
      sent = false;
      while (this.clientsQueue.length > 0 && !sent) {
        sent = this._sendQueueItemRequest(this.clientsQueue.shift(), item);
      }
      if (!sent) {
        this.queue.push(item);
      }
      return item;
    };

    PhantomQueuedClusterServer.prototype._onWorkerStarted = function(worker) {
      var _this = this;
      return worker.on("message", function(json) {
        var item, sent;
        if (json.action === "queueItemRequest") {
          if (_this.queue.length > 0) {
            item = _this.queue.shift();
            sent = _this._sendQueueItemRequest(worker, item);
            if (!sent) {
              return _this.enqueue(item.request);
            }
          } else {
            return _this.clientsQueue.push(worker);
          }
        } else if (json.action === "queueItemResponse") {
          item = _this._sentMessages[json.id];
          if (item) {
            item.finish(json.response);
            delete _this._sentMessages[json.id];
            return worker.send({
              action: "queueItemResponse",
              status: "OK"
            });
          } else {
            return worker.send({
              action: "queueItemResponse",
              status: "ignored"
            });
          }
        }
      });
    };

    PhantomQueuedClusterServer.prototype._sendQueueItemRequest = function(worker, item) {
      try {
        worker.send({
          action: "queueItemRequest",
          id: item.id,
          request: item.request
        });
      } catch (_error) {
        return false;
      }
      item.start(this.messageTimeout);
      item.on("timeout", function() {
        return worker.send({
          action: "queueItemTimeout",
          id: item.id
        });
      });
      this._sentMessages[item.id] = item;
      return true;
    };

    return PhantomQueuedClusterServer;

  })(PhantomClusterServer);

  PhantomQueuedClusterClient = (function(_super) {
    __extends(PhantomQueuedClusterClient, _super);

    function PhantomQueuedClusterClient(options) {
      this._onWorkerReady = __bind(this._onWorkerReady, this);
      this._onMessage = __bind(this._onMessage, this);
      PhantomQueuedClusterClient.__super__.constructor.call(this, options);
      this.currentRequestId = null;
      this.on("workerReady", this._onWorkerReady);
      process.on("message", this._onMessage);
    }

    PhantomQueuedClusterClient.prototype.queueItemResponse = function(response) {
      process.send({
        action: "queueItemResponse",
        id: this.currentRequestId,
        response: response
      });
      return this.next();
    };

    PhantomQueuedClusterClient.prototype._onMessage = function(json) {
      var _ref;
      if (json.action === "queueItemRequest") {
        this.currentRequestId = json.id;
        return this.emit("queueItemReady", json.request);
      } else if (json.action === "queueItemResponse") {
        if ((_ref = json.status) !== "OK" && _ref !== "ignored") {
          throw new Error("Unexpected status code from queueItemResponse message: " + json.status);
        }
      } else if (json.action === "queueItemTimeout") {
        return this.emit("queueItemTimeout", json.id);
      }
    };

    PhantomQueuedClusterClient.prototype._onWorkerReady = function() {
      return process.send({
        action: "queueItemRequest"
      });
    };

    return PhantomQueuedClusterClient;

  })(PhantomClusterClient);

  QueueItem = (function(_super) {
    __extends(QueueItem, _super);

    function QueueItem(id, request) {
      this._timeout = __bind(this._timeout, this);
      this.id = id;
      this.request = request;
      this.response = null;
      this.timeout = null;
    }

    QueueItem.prototype.start = function(timeout) {
      return this.timeout = setTimeout(this._timeout, timeout);
    };

    QueueItem.prototype.finish = function(response) {
      if (this.timeout) {
        clearTimeout(this.timeout);
      }
      this.response = response;
      return this.emit("response");
    };

    QueueItem.prototype._timeout = function() {
      return this.emit("timeout");
    };

    return QueueItem;

  })(events.EventEmitter);

  exports.create = create;

  exports.createQueued = createQueued;

  exports.PhantomClusterServer = PhantomClusterServer;

  exports.PhantomClusterClient = PhantomClusterClient;

  exports.PhantomQueuedClusterServer = PhantomQueuedClusterServer;

  exports.PhantomQueuedClusterClient = PhantomQueuedClusterClient;

}).call(this);
