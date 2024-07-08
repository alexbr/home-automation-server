'use strict';

import _ from 'lodash';
import { Router } from 'express';
const router = Router();
import settings from '../settings.js';
import { checkAuth } from '../lib/basic-auth.js';
import { sendCmd } from '../lib/amp-control.js';

// Amp
let ampHost;
if (settings.ampControl) {
  ampHost = _.get(settings, 'ampControl[0].host');
}

router.all('*', checkAuth(settings));

router.get('/', (_req, res) => {
  res.render('amp/index', {
    title: 'Amp Control',
    ampHost,
    urlPrefix: settings.urlPrefix,
  });
});

router.get('/error', (_req, res) => {
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

  return sendCmd(ampHost, cmd, options)
    .then(sendSuccess(res))
    .catch(e => sendError(res, e));
});

function sendSuccess(res) {
  res.redirect(`${settings.urlPrefix}/amp/`);
  return res;
}

function sendError(res, _msg) {
  res.redirect(`${settings.urlPrefix}/amp/error`);
  return res;
}

export default router;
