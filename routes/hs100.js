const _ = require('lodash');
const express = require('express');
const router = express.Router();
const hs100 = require('hs100-api');
const client = new hs100.Client({ debug: true });

// Find plugs
var plugs = {};
client.startDiscovery().on('plug-new', plug => {
   plugs[plug.name] = plug;
}).on('plug-offline', plug => {
   console.warn('plug offline', plug);
   delete plugs[plug.name];
});

router.get('/', (req, res) => {
   var plugsData = {};
   var promises = _.map(plugs, plug => {
      return getPlugData(plug).then(plugData => {
         plugsData[plugData.name] = plugData;
      });
   });

   Promise.all(promises).then(() => sendSuccess(res, plugsData));
});

router.get('/:plugname/toggle/:state', (req, res) => {
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

   plug.setPowerState(enabled).then(() => sendSuccess(res));
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

   getPlugData(plug).then(plugData => sendSuccess(res, plugData));
});

function getPlugData(plug) {
   var promises = [];
   var plugData = {
      name: plug.name,
      host: plug.host,
   };

   promises.push(plug.getInfo().then(info => {
      plugData.info = info;
   }));

   promises.push(plug.getPowerState().then(state => {
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
   res.status(500);
   res.json({ status: 'failure', error: msg });
   return res;
}

module.exports = router;
