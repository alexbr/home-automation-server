'use strict';

import _ from 'lodash';
import { Permission } from 'actions-on-google';
import logger from './logger.js';
import settings from '../settings.js';
import SonosAPI from './sonos-api.js';
import RoomServiceHelper from './room-service-helper.js';

const roomServiceHelper = new RoomServiceHelper();
const api = new SonosAPI(settings);

const UNKNOWN_DEVICE = 'unknown';

class SonosHandlers {

  constructor(discovery) {
    const handlers = new Map();

    // welcome action
    handlers.set('input.welcome', welcome);
    handlers.set('Welcome', welcome);

    function welcome(conv) {
      conv.close('Welcome to Kronos! Now what the hell do you want?');
    }

    // favorite action
    handlers.set('Play Favorite', playFavorite);
    function playFavorite(conv, params) {
      const { favorite, room } = params;
      return sonosAction(params, 'favorite', [favorite]).then(() => {
        conv.close(`Ok, playing favorite ${favorite} in ${room}`);
      }).catch(error => {
        reportError(conv, `Aww fuck, couldn't play ${favorite}`, error);
      });
    }

    // list favorites action
    handlers.set('List Favorites', listFavorites);
    function listFavorites(conv, params) {
      return sonosAction(params, 'favorites').then(res => {
        const msg = `Ok, favorites are ${res.response.join(', ')}`;
        conv.close(msg);
      });
    }

    handlers.set('Stop', stop);
    function stop(conv, params) {
      return sonosAction(params, 'pause').then(() => {
        conv.close('Ok, paused.');
      }).catch(err => {
        reportError(conv, 'Aww fuck, couldn\'t pause.', err);
      });
    }

    handlers.set('Play', play);
    function play(conv, params) {
      return sonosAction(params, 'play').then(() => {
        conv.close('Ok, playback started.');
      }).catch(err => {
        reportError(conv, 'Aww fuck, couldn\'t play.', err);
      });
    }

    handlers.set('Next', next);
    function next(conv, params) {
      return sonosAction(params, 'next').then(() => {
        conv.close('Ok, playing next track.');
      }).catch(err => {
        reportError(conv, 'Aww fuck, couldn\'t play next track.', err);
      });
    }

    handlers.set('Previous', previous);
    function previous(conv, params) {
      return sonosAction(params, 'previous').then(() => {
        conv.close('Ok, playing previous track.');
      }).catch(err => {
        reportError(conv, 'Aww fuck, couldn\'t play previous track.', err);
      });
    }

    handlers.set('Shuffle', shuffle);
    function shuffle(conv, params) {
      const mode = params.enabled.toLowerCase();

      return sonosAction(params, 'shuffle', [mode]).then(() => {
        if (mode === 'on') {
          conv.close('Ok, shuffle enabled.');
        } else {
          conv.close('Ok, shuffle disabled.');
        }
      }).catch(err => {
        reportError(conv, `Aww fuck, couldn't ${mode} shuffle`, err);
      });
    }

    handlers.set('Group Rooms', join);
    function join(conv, params) {
      const room = params.room;
      const receivingRoom = params.receivingRoom;

      return sonosAction(params, 'join', [receivingRoom]).then(() => {
        conv.close(`Ok, grouped ${room} with ${receivingRoom}`);
      }).catch(error => {
        reportError(conv, `Aww fuck, couldn't join ${room} to ${receivingRoom}`, error);
      });
    }

    handlers.set('Mute', mute);
    function mute(conv, params) {
      return sonosAction(params, 'mute').then(() => {
        conv.close('Ok');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t mute.', error);
      });
    }

    handlers.set('Unmute', unmute);
    function unmute(conv, params) {
      return sonosAction(params, 'unmute').then(() => {
        conv.close('Ok');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t unmute.', error);
      });
    }

    handlers.set('Set Volume', setVolume);
    function setVolume(conv, params) {
      const volume = conv.volume;

      return sonosAction(params, 'volume', [volume]).then(() => {
        conv.close('Ok, volume changed');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t change volume', error);
      });
    }

    handlers.set('Increase Volume', incVolume);
    function incVolume(conv, params) {
      return sonosAction(params, 'volume', ['+5']).then(() => {
        conv.close('Ok, volume increased');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t change volume', error);
      });
    }

    handlers.set('Decrease Volume', decVolume);
    function decVolume(conv, params) {
      return sonosAction(params, 'volume', ['-5']).then(() => {
        conv.close('Ok, volume decreased');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t change volume', error);
      });
    }

    handlers.set('Play Artist Radio', artistRadio);
    function artistRadio(conv, params) {
      const artist = params.artist;
      const values = [];
      values.push('spotify');
      values.push('station');
      values.push(artist);

      return sonosAction(params, 'musicSearch', values).then(() => {
        conv.close('Ok, playing ' + artist + 'radio.');
      }).catch(error => {
        reportError(conv, 'Aww fuck, couldn\'t play artist radio.', error);
      });
    }

    handlers.set('Play Album', playAlbum);
    function playAlbum(conv, params) {
      let album = params.album;
      let artist = params.artist;
      let query = album;
      if (artist)
        query += ' artist:' + artist;

      return doSearch(params, 'spotify', 'album', query).then(() => {
        conv.close('Ok, playing album ' + album + '.');
      }).catch(err => {
        if (err.error === 'No matches were found') {
          const albumAndArtist = findArtist(album);
          if (albumAndArtist) {
            query = albumAndArtist.query + ' artist:' + albumAndArtist.artist;

            return doSearch(params, 'spotify', 'album', query);
          }
        }

        return Promise.reject(err);
      }).then(() => {
        conv.close(`Ok, playing album ${album}.`);
      }).catch(error => {
        reportError(conv, `Aww, fuck. Couldn't play album ${album}.`, error);
      });
    }

    handlers.set('Play Song', playSong);
    function playSong(conv, params) {
      let track = params.song;
      let artist = params.artist;
      let query = 'track:' + track;
      if (artist)
        query += ' artist:' + artist;

      return doSearch(params, 'spotify', 'song', query).then(() => {
        conv.close(`Ok, playing song ${track}.`);
      }).catch(err => {
        if (err.error === 'No matches were found') {
          const trackAndArtist = findArtist(track);
          if (trackAndArtist) {
            query = 'track:' + trackAndArtist.query + ' artist:' +
              trackAndArtist.artist;

            return doSearch(params, 'spotify', 'song', query);
          }
        }

        return Promise.reject(err);
      }).then(() => {
        conv.close(`Ok, playing song ${track}.`);
      }).catch(error => {
        reportError(conv, `<speak>Aww <say-as>fuck</say-as>, couldn't play song ${track}.</speak>`, error);
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

    handlers.set('Search for Song', search);
    function search(conv, params) {
      const service = conv.service || 'spotify';
      const type = 'song'; //app.getArgument('type');
      const song = params.song;
      const artist = params.artist;
      let query = `track:${song}`;
      if (artist)
        query = `${query} artist:${artist}`;
      const values = [service, type, query];

      return sonosAction(params, 'search', values).then(res => {
        //return doSearch(params, service, type, query).then(res => {
        logger.warn(res.response);

        if (res.isUriAndMetadata) {
          conv.close('Found a station match.');
        } else {
          const tracks = res.response.queueTracks;
          if (!tracks || tracks.length === 0) {
            conv.close('Aww, shit. No matches for ' + song);
          } else {
            const track = tracks[0];

            if (tracks.length === 1) {
              conv.close(`OK. Playing ${track.trackName} by ${track.artistName}.`);
            } else {
              let msg = '';
              let foundTrack;

              _.each(tracks, (track, num) => {
                if (track.trackName.toLowerCase() === song.toLowerCase() &&
                  (artist && track.artistName.toLowerCase() === artist.toLowerCase())) {
                  // XXX play...
                  foundTrack = track;
                  conv.close(`OK. Playing ${track.trackName} by ${track.artistName}.`);
                  return false; // aka break
                }

                msg += `${num + 1}. ${track.trackName} by ${track.artistName}. `;

                if (num === 4) {
                  return false; // aka break;
                }
              });

              if (!foundTrack) {
                let question = 'Fuck there are a lot of options.';
                question += ` Which track? ${msg}`;
                conv.ask(question);
              }

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
        }
      });
    }

    function doSearch(params, service, type, query) {
      const values = [];
      values.push(service);
      values.push(type);
      values.push(query);

      return sonosAction(params, 'musicSearch', values);
    }

    handlers.set('Now Playing', whatsPlaying);
    function whatsPlaying(conv, params) {
      return sonosAction(params, 'state').then(res => {
        const result = res.response;
        const track = result.currentTrack.title;
        const artist = result.currentTrack.artist;
        conv.close(`This is ${track} by ${artist}.`);
      }).catch(error => {
        reportError(conv, `Aww, fuck. Couldn't get information.`, error);
      });
    }

    handlers.set('Sleep', sleep);
    function sleep(conv, params) {
      const timeout = params.timeout;
      const timeoutVal = timeout.amount;
      const timeoutUnit = timeout.unit;
      let timeoutSecs = timeoutVal;

      if (timeoutUnit === 'h') {
        timeoutSecs = timeoutVal * 3600;
      } else if (timeoutUnit === 'min') {
        timeoutSecs = timeoutVal * 60;
      } else if (timeoutUnit !== 's') {
        return Promise.resolve().then(() => {
          conv.close('Sorry, you can only set sleep in second, minute, or hour durations.');
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

      return sonosAction(params, 'sleep', [timeoutSecs]).then(() => {
        conv.close(`Ok, sleeping in ${duration}.`);
      }).catch(error => {
        reportError(conv, `Aww fuck, couldn't set sleep timeout.`, error);
      });
    }

    handlers.set('Sleep Off', sleepOff);
    function sleepOff(conv, params) {
      return sonosAction(params, 'sleep', ['off']).then(() => {
        conv.close('Ok, turning sleep off.');
      }).catch(error => {
        reportError(conv, `Aww fuck, couldn't disable sleep.`, error);
      });
    }

    handlers.set('Ask Permission', askPermission);
    function askPermission(conv) {
      conv.ask(new Permission({
        context: 'To figure out your device room',
        permissions: 'DEVICE_PRECISE_LOCATION',
      }));
    }

    handlers.set('Get Permission', gotPermission);
    function gotPermission(conv, params, granted) {
      if (granted) {
        const location = conv.device.location;
        logger.warn(location);
      }
    }

    handlers.set('Test', test);
    handlers.set('Test Get Room', test);
    function test(conv, params) {
      return getRoom(params).then(result => {
        logger.info('got room', result.room);
        if (result.fromUser) {
          logger.info('from user');
          logger.info('test arg', conv.contexts.get('getroom').parameters.test);
          conv.close('Ok, using room ' + result.room);
        } else {
          logger.info('from db');
          logger.info('test arg', params.test);
          conv.contexts.set('getroom');
          conv.ask(`Got saved room ${result.room}, but which room do you want?`);
        }
      }).catch(err => {
        logger.error('get error looking up room', err);
        conv.ask('Which room?');
      });
    }

    function sonosAction(params, action, values) {
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
      const room = params.room;
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
    function getRoom(params) {
      let room = params.room;
      if (!room) {
        return roomServiceHelper.loadRoomAndService(UNKNOWN_DEVICE, room).then(room => {
          return { room: room, fromDb: true };
        });
      } else {
        return Promise.resolve({ room: room, fromUser: true });
      }
    }

    function reportError(conv, msg, err) {
      logger.error(err);
      conv.close(msg);
    }

    this.getHandlers = function getHandlers() {
      return handlers;
    };
  }
}

export default SonosHandlers;
