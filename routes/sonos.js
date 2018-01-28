const express = require('express');
const SonosSystem = require('sonos-discovery');
const settings = require('../settings');
const logger = require('../lib/logger');
const SonosAPI = require('../lib/sonos-api');
const basicAuth = require('../lib/basic-auth');

function Sonos(discovery) {
   const api = new SonosAPI(settings);
   const router = express.Router();

   router.all('*', basicAuth.checkAuth(settings));

   router.get('/', (req, res) => {
      res.render('sonos/index', {
         title: 'Sonos API',
      });
   });

   router.get('*', (req, res) => {
      requestHandler(req, res);
   });

   this.getRouter = function getRouter() {
      return router;
   };

   function requestHandler(req, res) {
      if (req.url === '/favicon.ico') {
         res.end();
         return;
      }

      if (discovery.zones.length === 0) {
         const msg = 'No sonos system has been discovered.';
         logger.error(msg);
         sendResponse(500, { status: 'error', error: msg });
         return;
      }

      const params = req.url.substring(1).split('/');
      let player = discovery.getPlayer(decodeURIComponent(params[0]));
      const opt = {};

      if (player) {
         opt.action = (params[1] || '').toLowerCase();
         opt.values = params.splice(2);
      } else {
         player = discovery.getAnyPlayer();
         opt.action = (params[0] || '').toLowerCase();
         opt.values = params.splice(1);
      }

      opt.player = player;

      function sendResponse(code, body) {
         var jsonResponse = JSON.stringify(body);
         res.statusCode = code;
         res.setHeader('Content-Length', Buffer.byteLength(jsonResponse));
         res.setHeader('Content-Type', 'application/json;charset=utf-8');
         res.write(new Buffer(jsonResponse));
         res.end();
      }

      api.handleAction(opt).then((response) => {
         if (!response || response.constructor.name === 'IncomingMessage') {
            response = { status: 'success' };
         } else if (Array.isArray(response) && response.length > 0 && response[0].constructor.name === 'IncomingMessage') {
            response = { status: 'success' };
         }

         sendResponse(200, response);
      }).catch((error) => {
         logger.error(error);
         sendResponse(500, {
            status: 'error', error: error.message, stack: error.stack
         });
      });
   }
}

module.exports = Sonos;
