/* global describe, before, after, it */

'use strict';

var assert = require('assert');
var http = require('http');
var net = require('net');
var timeout = require('./');

it('should do HTTP request with a lot of time', function (done) {
	var req = http.get('http://google.com', function (res) {
		assert.ok(res.statusCode > 300 && res.statusCode < 399);
		done();
	});

	req.on('error', done);

	timeout(req, 1000);
});

it('should emit ETIMEDOUT when connection timeout expires', function (done) {
	// To prevent the connection from being established use a non-routable IP
	// address. See https://tools.ietf.org/html/rfc5737#section-3
	var req = http.get('http://192.0.2.1');

	req.on('error', function (err) {
		if (err.code === 'ETIMEDOUT') {
			assert.equal(err.message, 'Connection timed out on request to 192.0.2.1');
			done();
		}
	});

	timeout(req, 200);
});

describe('when connection is established', function () {
	var server;

	before(function (done) {
		server = http.createServer();
		server.listen(8081, done);
	});

	after(function (done) {
		server.close(done);
	});

	it('should emit ESOCKETTIMEDOUT (no data)', function (done) {
		server.once('request', function () {});

		var req = http.get('http://0.0.0.0:8081');

		req.on('error', function (err) {
			if (err.code === 'ESOCKETTIMEDOUT') {
				assert.equal(err.message, 'Socket timed out on request to 0.0.0.0:8081');
				done();
			}
		});

		timeout(req, 200);
	});

	it('should emit ESOCKETTIMEDOUT (only first chunk of body)', function (done) {
		server.once('request', function (req, res) {
			res.writeHead(200, {'content-type': 'text/plain'});
			setTimeout(function () {
				res.write('chunk');
			}, 100);
		});

		var called = false;
		var body = '';
		var req = http.get('http://0.0.0.0:8081');

		req.on('response', function (res) {
			called = true;
			assert.equal(res.statusCode, 200);
			assert.equal(res.headers['content-type'], 'text/plain');
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				body += chunk;
			});
		});

		req.on('error', function (err) {
			if (err.code === 'ESOCKETTIMEDOUT') {
				assert.ok(called);
				assert.equal(body, 'chunk');
				assert.equal(err.message, 'Socket timed out on request to 0.0.0.0:8081');
				done();
			}
		});

		timeout(req, {socket: 200, connect: 50});
	});

	it('should be able to only apply connect timeout', function (done) {
		server.once('request', function (req, res) {
			setTimeout(function () {
				res.writeHead(200);
				res.end('data');
			}, 100);
		});

		var req = http.get('http://0.0.0.0:8081');

		req.on('error', done);
		req.on('finish', done);

		timeout(req, {connect: 50});
	});

	it('should be able to only apply socket timeout', function (done) {
		server.once('request', function (req, res) {
			setTimeout(function () {
				res.writeHead(200);
				res.end('data');
			}, 200);
		});

		var req = http.get('http://0.0.0.0:8081');

		req.on('error', function (err) {
			if (err.code === 'ESOCKETTIMEDOUT') {
				assert.equal(err.message, 'Socket timed out on request to 0.0.0.0:8081');
				done();
			}
		});

		timeout(req, {socket: 50});
	});

	// Different requests may reuse one socket if keep-alive is enabled
	it('should not add event handlers twice for the same socket', function (done) {
		server.on('request', function (req, res) {
			res.writeHead(200);
			res.end('data');
		});

		var socket = null;
		var keepAliveAgent = new http.Agent({
			maxSockets: 1,
			keepAlive: true
		});

		var reqOpts = {
			hostname: '0.0.0.0',
			port: 8081,
			agent: keepAliveAgent
		};

		var req1 = http.get(reqOpts, function (resp) {
			resp.resume();
			var req2 = http.get(reqOpts, function (resp) {
				resp.resume();
				keepAliveAgent.destroy();
				server.removeAllListeners('request');
				done();
			});
			timeout(req2, 100);

			req2.on('socket', function (sock) {
				assert.equal(sock, socket);
				assert.equal(sock.listeners('connect').length, 0);
			});
		});
		timeout(req1, 100);

		req1.on('socket', function (sock) {
			socket = sock;
		});
	});

	it('should set socket timeout if socket is already connected', function (done) {
		server.once('request', function () {});

		var socket = net.connect(8081, '0.0.0.0', function () {
			var req = http.get({
				createConnection: function () {
					return socket;
				},
				hostname: '0.0.0.0',
				port: 8081
			});

			req.on('error', function (err) {
				if (err.code === 'ESOCKETTIMEDOUT') {
					done();
				}
			});

			timeout(req, 200);
		});
	});

	it.skip('should clear socket timeout for keep-alive sockets', function (done) {
		server.once('request', function (req, res) {
			res.writeHead(200);
			res.end('data');
		});

		var socket = null;
		var agent = new http.Agent({
			keepAlive: true,
			maxSockets: 1
		});

		var options = {
			hostname: '0.0.0.0',
			agent: agent,
			port: 8081
		};

		var req = http.get(options, function (res) {
			assert.equal(socket._idleTimeout, 100);
			res.resume();
			res.on('end', function () {
				assert.equal(socket.destroyed, false);
				assert.equal(socket._idleTimeout, -1);
				agent.destroy();
				done();
			});
		});

		timeout(req, 100);

		req.on('socket', function (sock) {
			sock.once('connect', function () {
				assert.equal(sock._idleTimeout, 100);
			});
			socket = sock;
		});
	});
});
