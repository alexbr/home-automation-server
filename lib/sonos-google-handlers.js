'use strict';

const logger = require('../lib/logger');
const settings = require('../settings');
const SonosAPI = require('../lib/sonos-api');
const api = new SonosAPI(settings);

function SonosHandlers(discovery) {
   const handlers = new Map();

   // welcome action
   handlers.set('input.welcome', welcome);
   function welcome(app) {
      app.tell('Welcome to ARod\'s sonos integration! Now what the hell do you want?');
   }

   // favorite action
   handlers.set('input.favorite.play', playFavorite);
   function playFavorite(app) {
      const favorite = app.getArgument('favorite').trim();
      const room = app.getArgument('room').trim();

      return sonosAction(app, 'favorite', [ favorite ]).then(result => {
         app.tell('Ok, playing favorite ' + favorite + ' in ' + room);
      }).catch(error => {
         app.tell('Aww damn, couldn\'t play ' + favorite);
      });
   }

   // list favorites action
   handlers.set('input.favorites.list', listFavorites);
   function listFavorites(app) {
      return sonosAction(app, 'favorites').then(res => {
         const msg = 'Ok, favorites are ' + res.response.join(', ');
         app.tell(msg);
      });
   }

   handlers.set('input.stop', stop);
   function stop(app) {
      return sonosAction(app, 'pause').then(res => {
         app.tell('Ok, paused.');
      });
   }

   handlers.set('input.join', join);
   function join(app) {
      const room = app.getArgument('room').trim();
      const receivingRoom = app.getArgument('receivingRoom').trim();

      return sonosAction(app, 'join', [ receivingRoom ]).then(res => {
         app.tell('Ok, grouped ' + room + ' with ' + receivingRoom);
      }).catch(error => {
         app.tell('Aww damn, couldn\'t join ' + room + ' to ' + receivingRoom);
      });
   }

   handlers.set('input.setvolume', setVolume);
   function setVolume(app) {
      const volume = app.getArgument('volume');

      return sonosAction(app, 'volume', [ volume ]).then(res => {
         app.tell('Ok, volume changed');
      }).catch(error => {
         app.tell('Aww damn, couldn\'t change volume');
      });
   }

   handlers.set('input.increasevolume', incVolume);
   function incVolume(app) {
      return sonosAction(app, 'volume', [ '+5' ]).then(res => {
         app.tell('Ok, volume increased');
      }).catch(error => {
         app.tell('Aww damn, couldn\'t change volume');
      });
   }

   handlers.set('input.decreasevolume', decVolume);
   function decVolume(app) {
      return sonosAction(app, 'volume', [ '-5' ]).then(res => {
         app.tell('Ok, volume decreased');
      }).catch(error => {
         app.tell('Aww damn, couldn\'t change volume');
      });
   }

   function sonosAction(app, action, values) {
      if (discovery.zones.length === 0) {
         const msg = 'No sonos system has been discovered.';
         logger.error(msg);
         return Promise.reject({
            code: 500,
            status: 'error',
            error: msg
         });
      }

      values = values || [];
      const room = app.getArgument('room');
      let player = discovery.getPlayer(decodeURIComponent(room));
      if (!player) {
         player = discovery.getAnyPlayer();
      }

      const opt = {
         action: (action || '').toLowerCase(),
         values: values,
         player: player
      };

      console.warn(opt.action);
      console.warn(opt.values);

      return api.handleAction(opt).then(response => {
         let status;

         if (!response || response.constructor.name === 'IncomingMessage') {
            status = 'success';
         } else if (Array.isArray(response) && response.length > 0 &&
            response[0].constructor.name === 'IncomingMessage') {
            status = 'success';
         }

         return {
            code: 200,
            status: status,
            response: response
         };
      }).catch(error => {
         logger.error(error);
         return Promise.reject({
            code: 500,
            status: 'error',
            error: error.message,
            stack: error.stack
         });
      });
   }

   this.getHandlers = function getHandlers() {
      return handlers;
   };
}

module.exports = SonosHandlers;
