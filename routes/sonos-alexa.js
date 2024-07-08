'use strict';

import { Router } from 'express';
import { get } from 'https';
import { parse } from 'url';
import { handler } from 'alexa-sdk';
import AlexaHandler from '../lib/sonos-alexa-handlers.js';
import settings from '../settings.js';
import { error as _error, info } from '../lib/logger.js';
import crypto from 'crypto';

const CERT_END = /-END CERTIFICATE-/;

function getCerts(data) {
  const certs = [];
  const lines = data.split('\r\n');
  let currentCert = [];

  lines.forEach(line => {
    currentCert.push(line);
    if (CERT_END.test(line)) {
      certs.push(currentCert.join('\r\n'));
      currentCert = [];
    }
  });

  return certs;
}

function validateSignature(req) {
  const certUrlHeader = req.get('SignatureCertChainUrl');
  const signature = req.get('Signature');
  const certUrl = parse(certUrlHeader);

  if (certUrl.protocol !== 'https:' ||
    (certUrl.port !== null && certUrl.port !== '443') ||
    certUrl.hostname !== 's3.amazonaws.com' ||
    certUrl.pathname.indexOf('/echo.api/') !== 0) {

    return Promise.reject('invalid url', certUrlHeader);
  }

  return new Promise((resolve, reject) => {
    get(certUrl, certRes => {
      const { statusCode } = certRes;
      if (statusCode !== 200) {
        certRes.resume();
        return reject(
          `cert retrieval from '${certUrl}' failed with status code ${statusCode}`);
      }

      let certData = '';

      certRes.on('data', data => {
        certData += data.toString();
      });

      certRes.on('end', () => {
        const certs = getCerts(certData);
        if (!certs || certs.length === 0) {
          return reject(`no certs returned from '${certUrl}'!`);
        }

        const verifier = crypto.createVerify('sha1');
        verifier.update(req.rawBody);

        if (verifier.verify(certs[0], signature, 'base64')) {
          return resolve();
        }

        reject('signature verification failed');
      });
    }).on('error', err => {
      _error(err);
      reject(err);
    });
  });
}

class SonosAlexa {
  constructor(discovery) {
    const router = Router();
    const alexaHandler = new AlexaHandler(discovery);
    const handlers = alexaHandler.getIntentHandlers();

    router.post('/', (req, res) => {
      if (req.url === '/favicon.ico') {
        res.end();
        return;
      }

      info(req.body);

      validateSignature(req).then(() => {
        // Build the context manually, because Amazon Lambda is missing
        const context = {
          succeed: result => {
            info(result);
            res.json(result);
          },
          fail: error => {
            _error(error);
          }
        };

        // Delegate the request to the Alexa SDK and the declared intent-handlers
        try {
          const alexa = handler(req.body, context);
          alexaHandler.setAlexa(alexa);
          alexa.appId = settings.appId;
          alexa.registerHandlers(handlers);
          alexa.execute();
        } catch (err) {
          _error(err);
        }
      }).catch(err => {
        if (err) {
          _error(err);
        }

        res.status(403).end();
      });
    });

    this.getRouter = function getRouter() {
      return router;
    };
  }
}

export default SonosAlexa;
