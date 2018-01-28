'use strict';

const basicAuth = require('basic-auth');

exports.checkAuth = settings => {
   return (req, res, next) => {
      if (settings.auth) {
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
      }
   };
};
