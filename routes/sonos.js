const express = require('express');
const router = express.Router();
const SonosSystem = require('sonos-discovery');
const SonosHttpAPI = require('sonos-http-api');
var settings = require('../settings');
settings.disableIpDiscovery = true;

const discovery = new SonosSystem(settings);
const api = new SonosHttpAPI(discovery, settings);

router.get('*', function(req, res) {
   api.requestHandler(req, res);
});

module.exports = router;
