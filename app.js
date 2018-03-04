'use strict';

const express = require('express');
const path = require('path');
const loggerWare = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const httpProxy = require('http-proxy');
const logger = require('./lib/logger');
const index = require('./routes/index');
const Sonos = require('./routes/sonos');
const hs100 = require('./routes/hs100');
//const SonosGoogle = require('./routes/sonos-google');
const SonosAlexa = require('./routes/sonos-alexa');
const settings = require('./settings');
const SonosSystem = require('sonos-discovery');

const discovery = new SonosSystem(settings);
const proxy = httpProxy.createProxyServer({ 
   target: 'https://localhost',
   secure: false,
});

var app = express();

app.use(loggerWare('dev'));

// Reverse proxy DMS services. Do this first before express/bodyParser get 
// their hands on the request.
app.all('/photo*', (req, res) => {
   proxy.web(req, res);
});

app.all('/file*', (req, res) => {
   proxy.web(req, res);
});

app.all('/audio*', (req, res) => {
   proxy.web(req, res);
});

app.all('/download*', (req, res) => {
   proxy.web(req, res);
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /static
//app.use(favicon(path.join(__dirname, 'static', 'favicon.ico')));

// Save raw body
app.use((req, res, next) => {
   let data = '';
   req.on('data', chunk => {
      data += chunk;
   });
   req.on('end', () => {
      req.rawBody = data;
   });

   next();
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'static')));

// Enable CORS requests
app.all('*', (req, res, next) => {
   res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
   res.set('Access-Control-Allow-Origin', '*');

   var acrh = req.headers['access-control-request-headers'];
   if (acrh) {
      res.set('Access-Control-Allow-Headers', acrh);
   }

   next();
});

app.use('/', index);

proxy.on('error', (err) => {
   logger.warn(err);
});

// Sonos via Echo w/ Lambda
// Serve up static files from the webroot
var sonosStatic = express.static(settings.webroot + '/sonos');
var sonos = new Sonos(discovery);
app.use('/sonos', sonosStatic, sonos.getRouter());

// Sonos via Google
//var sonosGoogle = new SonosGoogle(discovery);
//app.use('/sonos-google', sonosGoogle.getRouter());

var sonosAlexa = new SonosAlexa(discovery);
app.use('/sonos-alexa', sonosStatic, sonosAlexa.getRouter());

// TP-Link HS-100
app.use('/hs100', hs100);

// catch 404 and forward to error handler
app.use((req, res, next) => {
   var err = new Error('Not Found');
   err.status = 404;
   next(err);
});

// error handler
app.use((err, req, res, next) => {
   void(next);
   logger.error('an error occurred', err);

   // set locals, only providing error in development
   res.locals.message = err.message;
   res.locals.error = req.app.get('env') === 'development' ? err : {};

   // render the error page
   res.status(err.status || 500);
   res.render('error');
});

module.exports = app;
