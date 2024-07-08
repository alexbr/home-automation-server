'use strict';

import { inspect } from 'util';
import { Router } from 'express';
import settings from '../settings.js';
import { info } from '../lib/logger.js';
import { dialogflow } from 'actions-on-google';
import SonosHandlers from '../lib/sonos-google-handlers.js';
import { checkAuth } from '../lib/basic-auth.js';

function addIntents(app, intents) {
  intents.forEach((intent, intentName) => {
    app.intent(intentName, intent);
  });
}

class SonosGoogle {
  constructor(discovery) {
    const sonosHandlers = new SonosHandlers(discovery);
    const app = dialogflow();
    addIntents(app, sonosHandlers.getHandlers());

    const router = Router();

    router.all('*', checkAuth(settings));

    router.get('*', (req, res) => {
      requestHandler(req, res);
    });

    router.post('*', (req, res) => {
      info('request body:', inspect(req.body, { depth: null }));
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
}

export default SonosGoogle;
