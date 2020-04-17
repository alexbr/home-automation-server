'use strict';

const express = require('express');
const https = require('https');
const url = require('url');
const Alexa = require('alexa-sdk');
const AlexaHandler = require('../lib/sonos-alexa-handlers');
const settings = require('../settings');
const logger = require('../lib/logger');

let crypto;
try {
   crypto = require('crypto');
} catch (err) {
   logger.error('crypto support is disabled!');
}

const CERT_END = /-END CERTIFICATE-/;

function getCerts(data) {
   const certs = [];
   const lines = data.split('\n');
   let currentCert = [];

   lines.forEach(line => {
      currentCert.push(line);
      if (CERT_END.test(line)) {
         certs.push(currentCert.join('\n'));
         currentCert = [];
      }
   });

   return certs;
}

function validateSignature(req) {
   const certUrlHeader = req.get('SignatureCertChainUrl');
   const signature = req.get('Signature');
   const certUrl = url.parse(certUrlHeader);

   if (certUrl.protocol !== 'https:' ||
      (certUrl.port !== null && certUrl.port !== '443') ||
      certUrl.hostname !== 's3.amazonaws.com' ||
      certUrl.pathname.indexOf('/echo.api/') !== 0) {

      return Promise.reject('invalid url', certUrlHeader);
   }

   return new Promise((resolve, reject) => {
      https.get(certUrl, certRes => {
         certRes.on('data', data => {
            const certs = getCerts(data.toString());
            const verifier = crypto.createVerify('sha1');
            verifier.update(req.rawBody);

            if (verifier.verify(certs[0], signature, 'base64')) {
               resolve();
            } else {
               reject('signature verification failed');
            }
         });
      }).on('error', err => {
         logger.error(err);
         reject(err);
      });
   });
}

function SonosAlexa(discovery) {
   const router = express.Router();

   router.post('/', (req, res) => {
      if (req.url === '/favicon.ico') {
         res.end();
         return;
      }

      logger.info(req.body);

      validateSignature(req).then(() => {
         // Build the context manually, because Amazon Lambda is missing
         const context = {
            succeed: result => {
               logger.info(result);
               res.json(result);
            },
            fail: error => {
               logger.error(error);
            }
         };

         // Delegate the request to the Alexa SDK and the declared intent-handlers
         try {
            const alexa = Alexa.handler(req.body, context);
            const alexaHandler = new AlexaHandler(discovery, alexa);
            alexa.appId = settings.appId;
            alexa.registerHandlers(alexaHandler.getIntentHandlers());
            alexa.execute();
         } catch(err) {
            logger.error(err);
         }
      }).catch(err => {
         if (err) {
            logger.error(err);
         }

         res.status(403).end();
      });
   });

   this.getRouter = function getRouter() {
      return router;
   };
}

module.exports = SonosAlexa;
