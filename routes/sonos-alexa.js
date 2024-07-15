'use strict';

import { Router } from 'express';
import { get } from 'https';
import { parse } from 'url';
import { handler } from 'alexa-sdk';
import AlexaHandler from '../lib/sonos-alexa-handlers.js';
import settings from '../settings.js';
import logger from '../lib/logger.js';
import crypto from 'crypto';

const CERT_END = /-END CERTIFICATE-/;

class SonosAlexa {
  router;

  constructor(discovery) {
    this.router = Router();
    const alexaHandler = new AlexaHandler(discovery);
    this.registerRequestHandler(alexaHandler);
  }

  registerRequestHandler(alexaHandler) {
    const handlers = alexaHandler.getIntentHandlers();

    this.router.post('/', async (req, res) => {
      if (req.url === '/favicon.ico') {
        res.end();
        return;
      }

      logger.info(req.body);

      try {
        await this.validateSignature(req);
      } catch(err) {
        logger.error(err);
        res.status(403).end();
        return;
      }

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
        const alexa = handler(req.body, context);
        alexaHandler.setAlexa(alexa);
        alexa.appId = settings.appId;
        alexa.registerHandlers(handlers);
        alexa.execute();
      } catch (err) {
        logger.error(err);
        res.end();
      }
    });
  }

  async validateSignature(req) {
    const certUrlHeader = req.get('SignatureCertChainUrl');
    const signature = req.get('Signature');
    const certUrl = parse(certUrlHeader);

    if (certUrl.protocol !== 'https:' ||
      (certUrl.port !== null && certUrl.port !== '443') ||
      certUrl.hostname !== 's3.amazonaws.com' ||
      certUrl.pathname.indexOf('/echo.api/') !== 0) {

      return Promise.reject('invalid url', certUrlHeader);
    }

    get(certUrl, certRes => {
      const { statusCode } = certRes;
      if (statusCode !== 200) {
        certRes.resume();
        throw Error(`cert retrieval from '${certUrl}' failed with status code ${statusCode}`);
      }

      let certData = '';

      certRes.on('data', data => {
        certData += data.toString();
      });

      certRes.on('end', () => {
        const certs = this.getCerts(certData);
        if (!certs || certs.length === 0) {
          throw Error(`no certs returned from '${certUrl}'!`);
        }

        const verifier = crypto.createVerify('sha1');
        verifier.update(req.rawBody);

        if (verifier.verify(certs[0], signature, 'base64')) {
          return;
        }

        throw Error('signature verification failed');
      });
    }).on('error', err => {
        logger.error(err);
        throw Error(err);
      });
  }

  getCerts(data) {
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

  getRouter() {
    return this.router;
  }
}

export default SonosAlexa;
