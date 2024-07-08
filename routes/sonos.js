'use strict';

import { Router } from 'express';
import settings from '../settings.js';
import logger from '../lib/logger.js';
import SonosAPI from '../lib/sonos-api.js';
import { checkAuth } from '../lib/basic-auth.js';

class Sonos {

  router = new Router();
  discovery;
  api;

  constructor(discovery) {
    this.discovery = discovery;
    this.api = new SonosAPI(settings);

    this.router.all('*', checkAuth(settings));

    this.router.get('/', (_req, res) => {
      res.render('sonos/index', {
        title: 'Sonos API',
        urlPrefix: settings.urlPrefix,
      });
    });

    this.router.get('*', (req, res) => {
      requestHandler(req, res);
    });
  }

  getRouter() {
    return this.router;
  }

  sendResponse(res, code, body) {
    var jsonResponse = JSON.stringify(body);
    res.statusCode = code;
    res.setHeader('Content-Length', Buffer.byteLength(jsonResponse));
    res.setHeader('Content-Type', 'application/json;charset=utf-8');
    res.write(new Buffer(jsonResponse));
    res.end();
  }

  requestHandler(req, res) {
    if (req.url === '/favicon.ico') {
      res.end();
      return;
    }

    if (this.discovery.zones.length === 0) {
      const msg = 'No sonos system has been discovered.';
      logger.error(msg);
      this.sendResponse(500, { status: 'error', error: msg });
      return;
    }

    const params = req.url.substring(1).split('/');
    let player = this.discovery.getPlayer(decodeURIComponent(params[0]));
    const opt = {};

    if (player) {
      opt.action = (params[1] || '').toLowerCase();
      opt.values = params.splice(2);
    } else {
      player = this.discovery.getAnyPlayer();
      opt.action = (params[0] || '').toLowerCase();
      opt.values = params.splice(1);
    }

    opt.player = player;

    this.api.handleAction(opt).then((response) => {
      if (!response || response.constructor.name === 'IncomingMessage') {
        response = { status: 'success' };
      } else if (Array.isArray(response) && response.length > 0 && response[0].constructor.name === 'IncomingMessage') {
        response = { status: 'success' };
      }

      this.sendResponse(200, response);
    }).catch((error) => {
        logger.error(error);
        this.sendResponse(500, {
          status: 'error', error: error.message, stack: error.stack
        });
      });
  }
}

export default Sonos;
