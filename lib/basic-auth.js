'use strict';

const _ = require('lodash');
const logger = require('./logger');
const basicAuth = require('basic-auth');

exports.checkAuth = settings => {
   return (req, res, next) => {
      if (settings.auth) {
         const username = settings.auth.username;
         const password = settings.auth.password;
         const user = basicAuth(req);

         if (!user || user.name !== username || user.pass !== password) {
            logger.warn(`access denied for user ${_.get(user, 'name', 'none given')} from ${req.headers['x-forwarded-for']}`);
            res.status(401);
            res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
            res.end('Access denied');
            return;
         } else {
            next();
         }
      }
   };
};
