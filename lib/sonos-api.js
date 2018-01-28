const fs = require('fs');
const path = require('path');

function SonosAPI(settings) {
   const self = this;
   const actions = {};

   // this handles registering of all actions
   this.registerAction = function registerAction(action, handler) {
      actions[action] = handler;
   };

   this.handleAction = function handleAction(options) {
      var player = options.player;

      if (!actions[options.action]) {
         return Promise.reject({ error: 'action \'' + options.action + '\' not found' });
      }

      return actions[options.action](player, options.values);
   };

   this.getPort = function getPort() {
      return settings.https ? settings.securePort : settings.port;
   };

   this.getWebRoot = function () {
      return settings.webroot;
   };

   function requireDir(cwd, cb) {
      let files = fs.readdirSync(cwd);

      files.map((name) => {
         let fullPath = path.join(cwd, name);
         return {
            name,
            fullPath,
            stat: fs.statSync(fullPath)
         };
      }).filter((file) => {
         return !file.stat.isDirectory() &&
            !file.name.startsWith('.') &&
            file.name.endsWith('.js');
      }).forEach((file) => {
         cb(require(file.fullPath));
      });
   }

   // load modularized actions
   requireDir(path.join(__dirname, '/actions'), registerAction => {
      registerAction(self);
   });
}

module.exports = SonosAPI;
