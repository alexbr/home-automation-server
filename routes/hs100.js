'use strict';

const _ = require('lodash');
const express = require('express');
const router = express.Router();
const hs100 = require('tplink-smarthome-api');
const client = new hs100.Client({ debug: true });
const logger = require('../lib/logger');
const settings = require('../settings');
const basicAuth = require('../lib/basic-auth');

// Find plugs
const plugs = {};
client.startDiscovery().on('plug-new', plug => {
   logger.info(`found plug ${plug.name} at ${plug.host}`);
   plugs[plug.name] = plug;
}).on('plug-offline', plug => {
   logger.warn('plug offline', plug);
   delete plugs[plug.name];
});

router.all('*', basicAuth.checkAuth(settings));

router.get('/', (req, res) => {
   getAllPlugsData().then(plugsData => {
      res.render('hs100/index', {
         title: 'HS100',
         plugsData: plugsData,
      });
   });
});

router.get('/info', (req, res) => {
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

function getAllPlugsData() {
   const plugsData = {};
   const promises = _.map(plugs, plug => {
      return getPlugData(plug).then(plugData => {
         plugsData[plugData.name] = plugData;
      });
   });

   return Promise.all(promises).then(() => plugsData);
}

function getPlugData(plug) {
   const promises = [];
   const plugData = {
      name: plug.name,
      host: plug.host,
   };

   logger.warn('getting plug data', plug.name, plug.host);

   promises.push(plug.getInfo({timeout:3000}).then(info => {
      logger.info('got plug data', plug.name);
      plugData.info = info;
   }));

   promises.push(plug.getPowerState({timeout:3000}).then(state => {
      logger.info('got plug state', plug.name, state);
      plugData.state = state;
   }));

   return Promise.all(promises).then(() => plugData);
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
   logger.error('error', msg);

   res.status(500);
   res.json({ status: 'failure', error: msg });
   return res;
}

module.exports = router;
