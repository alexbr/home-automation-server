'use strict';

const _ = require('lodash');
const express = require('express');
const router = express.Router();
const settings = require('../settings');
const logger = require('../lib/logger');
const basicAuth = require('../lib/basic-auth');
const ampControl = require('../lib/amp-control');

// Amp
let ampHost;
if (settings.ampControl) {
   ampHost = _.get(settings, 'ampControl[0].host');
}

router.all('*', basicAuth.checkAuth(settings));

router.get('/', (req, res) => {
   res.render('amp/index', {
      title: 'Amp Control',
      ampHost,
      urlPrefix: settings.urlPrefix,
   });
});

router.get('/error', (req, res) => {
   res.render('amp/index', {
      title: 'Amp Control',
      error: true,
      ampHost,
      urlPrefix: settings.urlPrefix,
   });
});

router.get('/:cmd', (req, res) => {
   const cmd = req.params.cmd;

   let options = {};
   if (cmd === 'volup' || cmd === 'voldown') {
      options.amount = 5;
   }

   return ampControl.sendCmd(ampHost, cmd, options)
      .then(sendSuccess(res))
      .catch(e => sendError(res, e));
});

function sendSuccess(res) {
   res.redirect(`${settings.urlPrefix}/amp/`);
   return res;
}

function sendError(res, msg) {
   res.redirect(`${settings.urlPrefix}/amp/error`);
   return res;
}

module.exports = router;
