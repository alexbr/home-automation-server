const express = require('express');
const router = express.Router();
const SonosSystem = require('sonos-discovery');
const SonosHttpAPI = require('sonos-http-api');
const settings = require('../settings');

settings.disableIpDiscovery = true;

const discovery = new SonosSystem(settings);
const api = new SonosHttpAPI(discovery, settings);

router.get('/', (req, res) => {
   res.render('sonos/index', {
      title: 'Sonos API',
   });
});

router.get('*', (req, res) => {
   api.requestHandler(req, res);
});

module.exports = router;
