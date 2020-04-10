'use strict';

const _ = require('lodash');
const util = require('util');
const fs = require('fs');
const path = require('path');
const express = require('express');
const settings = require('../settings');
const logger = require('../lib/logger');
const { dialogflow } = require('actions-on-google');
const SonosHandlers = require('../lib/sonos-google-handlers');
const basicAuth = require('../lib/basic-auth');

function addIntents(app, intents) {
   intents.forEach((intent, intentName) => {
      app.intent(intentName, intent);
   });
}

function SonosGoogle(discovery) {
   const sonosHandlers = new SonosHandlers(discovery);
   const app = dialogflow();
   addIntents(app, sonosHandlers.getHandlers());

   const router = express.Router();

   router.all('*', basicAuth.checkAuth(settings));

   router.get('*', (req, res) => {
      requestHandler(req, res);
   });

   router.post('*', (req, res) => {
      logger.info('request body:', util.inspect(req.body, {depth:null}));
      requestHandler(req, res);
   });

   this.getRouter = function getRouter() {
      return router;
   };

   function requestHandler(request, response) {
      if (request.url === '/favicon.ico') {
         response.end();
         return;
      }

      return app(request, response);
   }
}

module.exports = SonosGoogle;
