'use strict';

import _  from 'lodash';
import { Router } from 'express';
const router = Router();
import { Client } from 'tplink-smarthome-api';
const client = new Client({ debug: true });
import { info as _info, warn, error as _error } from '../lib/logger.js';
import settings from '../settings.js';
import { checkAuth } from '../lib/basic-auth.js';

// Find plugs
const plugs = {};
client.startDiscovery().on('plug-new', plug => {
  _info(`found plug ${plug.name} at ${plug.host}`);
  plugs[plug.name] = plug;
}).on('plug-offline', plug => {
  warn('plug offline', plug);
  delete plugs[plug.name];
});

router.all('*', checkAuth(settings));

router.get('/', (_req, res) => {
  getAllPlugsData().then(plugsData => {
    res.render('hs100/index', {
      title: 'HS100',
      plugsData: plugsData,
      urlPrefix: settings.urlPrefix,
    });
  });
});

router.get('/info', (_req, res) => {
  getAllPlugsData().then(plugsData => sendSuccess(res, plugsData));
});

router.get('/:plugname/state', (req, res) => {
  var plugname = req.params.plugname;
  if (_.isEmpty(plugname)) {
    return sendError(res, 'Plug name is required.');
  }

  var plug = plugs[plugname];
  if (!plug) {
    return sendError(res, `Plug ${plugname} not found.`);
  }

  getPlugData(plug).then(plugData => {
    sendSuccess(res, { state: plugData.state });
  });
});

router.get('/:plugname/:state', (req, res) => {
  var plugname = req.params.plugname;
  var state = req.params.state;

  if (_.isEmpty(plugname) || _.isEmpty(state)) {
    return sendError(res, 'Plug name and state are required.');
  }

  var plug = plugs[plugname];
  if (!plug) {
    return sendError(res, `Plug ${plugname} not found.`);
  }

  state = state.toLowerCase();
  var enabled = state === 'true' || state === 't' || state === 'on';

  plug.setPowerState(enabled).then(() => {
    getPlugData(plug).then(plugData => {
      sendSuccess(res, { state: plugData.state });
    });
  });
});

router.get('/:plugname', (req, res) => {
  const plugname = req.params.plugname;
  const plug = plugs[plugname];
  if (!plug) {
    return sendError(res, `Plug ${plugname} not found.`);
  }

  return getPlugData(plug).then(plugData => sendSuccess(res, plugData));
});

async function getAllPlugsData() {
  const plugsData = {};
  const promises = _.map(plugs, async plug => {
    const plugData = await getPlugData(plug);
    plugsData[plugData.name] = plugData;
  });

  await Promise.all(promises);
  return plugsData;
}

async function getPlugData(plug) {
  const promises = [];
  const plugData = {
    name: plug.name,
    host: plug.host,
  };

  warn('getting plug data', plug.name, plug.host);

  promises.push(plug.getInfo({ timeout: 3000 }).then(info => {
    _info('got plug data', plug.name);
    plugData.info = info;
  }));

  promises.push(plug.getPowerState({ timeout: 3000 }).then(state => {
    _info('got plug state', plug.name, state);
    plugData.state = state;
  }));

  await Promise.all(promises);
  return plugData;
}

function sendSuccess(res, data) {
  if (data === undefined) {
    data = {};
  }

  res.status(200);
  res.json({ status: 'success', result: data });
  return res;
}

function sendError(res, msg) {
  _error('error', msg);

  res.status(500);
  res.json({ status: 'failure', error: msg });
  return res;
}

export default router;
