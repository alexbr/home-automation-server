'use strict';

const express = require('express');
const router = express.Router();
const settings = require('../settings');
const basicAuth = require('../lib/basic-auth');

router.all('/', basicAuth.checkAuth(settings));

/* GET home page. */
router.get('/', (req, res) => {
   res.render('index', {
      urlPrefix: settings.urlPrefix,
      title: "Alex's Home Automation Server"
   });
});

module.exports = router;
