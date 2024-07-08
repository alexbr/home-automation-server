'use strict';

import { Router } from 'express';
const router = Router();
import settings from '../settings.js';
import { checkAuth } from '../lib/basic-auth.js';

router.all('/', checkAuth(settings));

/* GET home page. */
router.get('/', (_req, res) => {
  res.render('index', {
    urlPrefix: settings.urlPrefix,
    title: "Alex's Home Automation Server"
  });
});

export default router;
