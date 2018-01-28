'use strict';

const logger = require('../lib/logger');
const settings = require('../settings');
const SonosAPI = require('../lib/sonos-api');
const api = new SonosAPI(settings);
const mysql = require('mysql');

let mysqlPool;
if (settings.db) {
   if (settings.db.mysql) {
      const mysqlConf = settings.db.mysql;
      logger.info('setting up mysql connection', settings.db.mysql);
      mysqlPool = mysql.createPool({
         socketPath: mysqlConf.socket,
         user: mysqlConf.user,
         password: mysqlConf.password,
         database: mysqlConf.database
      });
   }
}

function SonosHandlers(discovery) {
   const handlers = new Map();

   // welcome action
   handlers.set('input.welcome', welcome);
   function welcome(app) {
      app.tell('Welcome to Kronos! Now what the hell do you want?');
   }

   // favorite action
   handlers.set('input.favorite.play', playFavorite);
   function playFavorite(app) {
      const favorite = app.getArgument('favorite').trim();
      const room = app.getArgument('room').trim();

      return sonosAction(app, 'favorite', [ favorite ]).then(result => {
         app.tell('Ok, playing favorite ' + favorite + ' in ' + room);
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t play ' + favorite);
      });
   }

   // list favorites action
   handlers.set('input.listfavorites', listFavorites);
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
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t pause.');
      });
   }

   handlers.set('input.play', play);
   function play(app) {
      return sonosAction(app, 'play').then(res => {
         app.tell('Ok, playback started.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t play.');
      });
   }

   handlers.set('input.next', next);
   function next(app) {
      return sonosAction(app, 'next').then(res => {
         app.tell('Ok, playing next track.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t play next track.');
      });
   }

   handlers.set('input.previous', previous);
   function previous(app) {
      return sonosAction(app, 'previous').then(res => {
         app.tell('Ok, playing previous track.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t play previous track.');
      });
   }

   handlers.set('input.shuffle', shuffle);
   function shuffle(app) {
      const mode = app.getArgument('enabled').toLowerCase();

      return sonosAction(app, 'shuffle', [ mode ]).then(res => {
         if (mode === 'on') {
            app.tell('Ok, shuffle enabled.');
         } else {
            app.tell('Ok, shuffle disabled.');
         }
      });
   }

   handlers.set('input.join', join);
   function join(app) {
      const room = app.getArgument('room').trim();
      const receivingRoom = app.getArgument('receivingRoom').trim();

      return sonosAction(app, 'join', [ receivingRoom ]).then(res => {
         app.tell('Ok, grouped ' + room + ' with ' + receivingRoom);
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t join ' + room + ' to ' + receivingRoom);
      });
   }

   handlers.set('input.mute', mute);
   function mute(app) {
      return sonosAction(app, 'mute').then(res => {
         app.tell('Ok');
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t mute.');
      });
   }

   handlers.set('input.unmute', unmute);
   function unmute(app) {
      return sonosAction(app, 'unmute').then(res => {
         app.tell('Ok');
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t unmute.');
      });
   }

   handlers.set('input.setvolume', setVolume);
   function setVolume(app) {
      const volume = app.getArgument('volume');

      return sonosAction(app, 'volume', [ volume ]).then(res => {
         app.tell('Ok, volume changed');
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t change volume');
      });
   }

   handlers.set('input.increasevolume', incVolume);
   function incVolume(app) {
      return sonosAction(app, 'volume', [ '+5' ]).then(res => {
         app.tell('Ok, volume increased');
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t change volume');
      });
   }

   handlers.set('input.decreasevolume', decVolume);
   function decVolume(app) {
      return sonosAction(app, 'volume', [ '-5' ]).then(res => {
         app.tell('Ok, volume decreased');
      }).catch(error => {
         app.tell('Aww fuck, couldn\'t change volume');
      });
   }

   handlers.set('input.artistradio', artistRadio);
   function artistRadio(app) {
      const artist = app.getArgument('artist');
      const values = [];
      values.push('spotify');
      values.push('station');
      values.push(artist);

      return sonosAction(app, 'musicSearch', values).then(res => {
         app.tell('Ok, playing ' + artist + 'radio.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t play artist radio.');
      });
   }

   handlers.set('input.playalbum', playAlbum);
   function playAlbum(app) {
      let album = app.getArgument('album');
      let artist = app.getArgument('artist');
      let query = album;
      if (artist) query += ' artist:' + artist;

      return doSearch(app, 'spotify', 'album', query).then(res => {
         app.tell('Ok, playing album ' + album + '.');
      }).catch(err => {
         if (err.error === 'No matches were found') {
            const albumAndArtist = findArtist(album);
            if (albumAndArtist) {
               query = albumAndArtist.query + ' artist:' +
                  albumAndArtist.artist;

               return doSearch(app, 'spotify', 'album', query);
            }
         }

         return Promise.reject(err);
      }).then(res => {
         app.tell('Ok, playing album ' + album + '.');
      }).catch(err => {
         app.tell('Aww, fuck. Couldn\'t play album ' + album);
      });
   }

   handlers.set('input.playtrack', playTrack);
   function playTrack(app) {
      let track = app.getArgument('song');
      let artist = app.getArgument('artist');
      let query = 'track:' + track;
      if (artist) query += ' artist:' + artist;

      return doSearch(app, 'spotify', 'song', query).then(res => {
         app.tell('Ok, playing song ' + track + '.');
      }).catch(err => {
         if (err.error === 'No matches were found') {
            const trackAndArtist = findArtist(track);
            if (trackAndArtist) {
               query = 'track:' + trackAndArtist.query + ' artist:' +
                  trackAndArtist.artist;

               return doSearch(app, 'spotify', 'song', query);
            }
         }

         return Promise.reject(err);
      }).then(res => {
         app.tell('Ok, playing song ' + track + '.');
      }).catch(err => {
         app.tell('<speak>Aww <say-as>fuck</say-as>, couldn\'t play song ' +
            track + '.</speak>');
      });
   }

   function findArtist(query) {
      const indexOfBy = query.lastIndexOf(' by ');
      if (indexOfBy > 0) {
         return {
            query: query.substring(0, indexOfBy),
            artist: query.substring(indexOfBy + 4, query.length),
         };
      }
   }

   handlers.set('input.searchsong', search);
   function search(app) {
      const service = app.getArgument('service') || 'spotify';
      const type = 'song';//app.getArgument('type');
      const song = app.getArgument('song');
      const values = [ service, type, song ];

      return sonosAction(app, 'search', values).then(res => {
         if (res.isUriAndMetadata) {
            app.tell('Found a station match.');
         } else {
            const tracks = res.response.queueTracks;
            if (!tracks || tracks.length === 0) {
               app.tell('Aww, shit. No matches for ' + song);
            } else {
               const track = tracks[0];
               const desc = track.trackName + ' by ' + track.artistName;
               let question = '<speak><say-as>Fuck</say-as> there are a lot of options.';
               question += ' Which track?';
               question += ` ${desc}</speak>`;
               app.ask(question);
               /*
               const items = tracks.map(track => {
                  console.warn(track);
                  const desc = track.trackName + ' by ' + track.artistName;
                  return app.buildOptionItem(track.uri)
                     .setTitle(desc)
                     .setDescription(desc);
               });
               console.warn(items);
               app.askWithCarousel('Which track?',
                  app.buildCarousel().addItems(items));
               */
            }
         }
      });
   }

   function doSearch(app, service, type, query) {
      const values = [];
      values.push(service);
      values.push(type);
      values.push(query);

      return sonosAction(app, 'musicSearch', values);
   }

   handlers.set('input.whatsplaying', whatsPlaying);
   function whatsPlaying(app) {
      return sonosAction(app, 'state').then(res => {
         const result = res.response;
         const track = result.currentTrack.title;
         const artist = result.currentTrack.artist;
         app.tell('This is ' + track + ' by ' + artist);
      }).catch(err => {
         app.tell('Aww, fuck. Couldn\'t get information.');
      });
   }

   handlers.set('input.sleep', sleep);
   function sleep(app) {
      const timeout = app.getArgument('timeout');
      const timeoutVal = timeout.amount;
      const timeoutUnit = timeout.unit;
      let timeoutSecs = timeoutVal;

      if (timeoutUnit === 'h') {
         timeoutSecs = timeoutVal * 3600;
      } else if (timeoutUnit === 'min') {
         timeoutSecs = timeoutVal * 60;
      } else if (timeoutUnit !== 's') {
         return Promise.resolve().then(() => {
            app.tell('Sorry, you can only set sleep in second, minute, or hour durations.');
         });
      }

      if (timeoutSecs <= 0) {
         timeoutSecs = 60;
      } else if (timeoutSecs >= 24 * 3600) {
         // sonos only supports sleep < 1 day ?
         timeoutSecs = 24 * 3600 - 1;
      }

      let duration = '';
      let remainder = timeoutSecs;

      // Shouldn't hit this...
      let days = Math.floor(remainder / (24 * 3600));
      if (days) {
         duration += days + ' days ';
         remainder = remainder % (days * 24 * 3600);
      }
      let hours = Math.floor(remainder / 3600);
      if (hours) {
         duration += hours + ' hours ';
         remainder = remainder % (hours * 3600);
      }
      let minutes = Math.floor(remainder / 60);
      if (minutes) {
         duration += minutes + ' minutes ';
         remainder = remainder % (minutes * 60);
      }
      if (remainder) {
         duration += remainder + ' seconds';
      }

      return sonosAction(app, 'sleep', [ timeoutSecs ]).then(res => {
         app.tell('Ok, sleeping in ' + duration + '.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t set sleep timeout.');
      });
   }

   handlers.set('input.sleepoff', sleepOff);
   function sleepOff(app) {
      return sonosAction(app, 'sleep', [ 'off' ]).then(res => {
         app.tell('Ok, turning sleep off.');
      }).catch(err => {
         app.tell('Aww fuck, couldn\'t disable sleep.');
      });
   }

   handlers.set('input.test', test);
   handlers.set('input.test.getroom', test);
   function test(app) {
      return getRoom(app).then(result => {
         logger.info('got room', result.room);
         if (result.fromUser) {
            logger.info('from user');
            logger.info('test arg', app.getContextArgument('getroom', 'test').value);
            app.tell('Ok, using room ' + result.room);
         } else {
            logger.info('from db');
            logger.info('test arg', app.getArgument('test'));
            app.setContext('getroom');
            app.ask('Got saved room ' + result.room + ', but which room do you want?');
         }
      }).catch(err => {
         logger.error('get error looking up room', err);
         app.ask('Which room?');
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
            error: error.message ? error.message : error,
            stack: error.stack ? error.stack : error
         });
      });
   }

   /**
    * @returns {Promise} resolves to room
    */
   function getRoom(app) {
      let room = app.getArgument('room');
      if (!room) {
         return getLastRoomFromDb().then(room => {
            return { room: room, fromDb: true };
         });
      } else {
         return Promise.resolve({ room: room, fromUser: true });
      }
   }

   function getLastRoomFromDb() {
      if (mysqlPool) {
         return new Promise((resolve, reject) => {
            return mysqlPool.getConnection((err, conn) => {
               if (err) {
                  return reject(err);
               }

               conn.query('select room_name from last_room', (err, res) => {
                  if (err) {
                     reject(err);
                  } else {
                     resolve(res[0].room_name);
                  }

                  conn.release();
               });
            });
         });
      } else {
         return Promise.reject('no database configured');
      }
   }

   this.getHandlers = function getHandlers() {
      return handlers;
   };
}

module.exports = SonosHandlers;
