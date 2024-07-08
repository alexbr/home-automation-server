'use strict';

import _ from 'lodash';
import path from 'path';
import requireDir from './helpers/require-dir.js';
import dirname from './helpers/dirname.js';

const dirName = dirname(import.meta.url);

class SonosAPI {
  settings;
  actions = {};

  constructor(settings) {
    this.settings = settings;
    this.loadActions();
  }

  // this handles registering of all actions
  registerAction(action, handler) {
    this.actions[action] = handler;
  }

  handleAction(options) {
    var player = options.player;

    if (!this.actions[options.action]) {
      return Promise.reject({ error: `action ' ${options.action}' not found` });
    }

    return this.actions[options.action](player, options.values);
  }

  getPort() {
    return this.settings.https ? this.settings.securePort : this.settings.port;
  }

  function() {
    return settings.webroot;
  }

  loadActions() {
    const self = this;

    // load modularized actions
    requireDir(path.join(dirName, '/actions'), registerAction => {
      registerAction(self);
    });
  }
}

export default SonosAPI;
