'use strict';

import _  from 'lodash';
import { warn } from './logger.js';
import basicAuth from 'basic-auth';

export function checkAuth(settings) {
  return (req, res, next) => {
    if (settings.auth) {
      const { username, password } = settings.auth;
      const user = basicAuth(req);

      if (!user || user.name !== username || user.pass !== password) {
        warn(`access denied for user ${_.get(user, 'name', 'none given')} from ${req.headers['x-forwarded-for']}`);
        res.status(401);
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
        res.end('Access denied');
        return;
      } else {
        next();
      }
    }
  };
}
