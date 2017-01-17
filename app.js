"use strict";

const express = require('express');
const basicAuth = require('basic-auth');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

const index = require('./routes/index');
const sonos = require('./routes/sonos');
const hs100 = require('./routes/hs100');
const settings = require('./settings');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

if (settings.auth) {
   app.all('*', (req, res, next) => {
      const username = settings.auth.username;
      const password = settings.auth.password;
      const user = basicAuth(req);

      if (!user || user.name !== username || user.pass !== password) {
         res.status(401);
         res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
         res.end('Access denied');
         return;
      } else {
         next();
      }
   });
}

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

// Serve up static files from the webroot
var sonosStatic = express.static(settings.webroot);

app.use('/sonos', sonosStatic, sonos);
app.use('/hs100', hs100);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
