'use strict';

const util = require('util');
const fs = require('fs');
const path = require('path');
const express = require('express');
const settings = require('../settings');
const logger = require('../lib/logger');
const { DialogflowApp } = require('actions-on-google');
const SonosHandlers = require('../lib/sonos-google-handlers');
const basicAuth = require('../lib/basic-auth');

function SonosGoogle(discovery) {
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

   const sonosHandlers = new SonosHandlers(discovery);

   function requestHandler(request, response) {
      if (request.url === '/favicon.ico') {
         response.end();
         return;
      }

      const app = new DialogflowApp({
         request: request,
         response: response
      });

      app.handleRequest(sonosHandlers.getHandlers());
   }
}

module.exports = SonosGoogle;
