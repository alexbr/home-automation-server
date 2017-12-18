const fs = require('fs');
const path = require('path');
const express = require('express');
const { DialogflowApp } = require('actions-on-google');
const SonosHandlers = require('../lib/sonos-google-handlers');

function SonosGoogle(discovery) {
   const router = express.Router();

   router.get('*', (req, res) => {
      requestHandler(req, res);
   });

   router.post('*', (req, res) => {
      console.warn('aaaaaaaaaaaaaaaaaw yis', req.body);
      requestHandler(req, res);
   });

   this.getRouter = function getRouter() {
      return router;
   };

   const sonosHandlers = new SonosHandlers(discovery);

   function requestHandler(request, response) {
      console.warn('handling request');

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
