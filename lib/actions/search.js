'use strict';

const request = require('request-promise');
const logger = require('../logger');

const appleDef = require('../music_services/appleDef');
const spotifyDef = require('../music_services/spotifyDef');
const deezerDef = require('../music_services/deezerDef');
const eliteDef = deezerDef.init(true);
const libraryDef = require('../music_services/libraryDef');

const musicServices = ['apple','spotify','deezer','elite','library'];
const serviceNames = {
   apple:'Apple Music',spotify:'Spotify',deezer:'Deezer',elite:'Deezer',library:'Library'
};
const musicTypes = ['album','song','station','load','playlist'];

var country = '';
var accountId = '';
var accountSN = '';
var searchType = 0;

function getService(service) {
   if (service == 'apple') {
      return appleDef;
   } else if (service == 'spotify') {
      return spotifyDef;
   } else if (service == 'deezer') {
      return deezerDef;
   } else if (service == 'elite') {
      return eliteDef;
   } else if (service == 'library') {
      return libraryDef;
   }
}

function getAccountId(player, service) {
   accountId = '';

   if (service !== 'library') {
      const req = { url: player.baseUrl + '/status/accounts', json: false };
      return request(req).then(res => {
         var actLoc = res.indexOf(player.system.getServiceType(serviceNames[service]));

         if (actLoc != -1) {
            var idLoc = res.indexOf('<UN>', actLoc)+4;
            var snLoc = res.indexOf('SerialNum="', actLoc)+11;

            accountId = res.substring(idLoc,res.indexOf('</UN>',idLoc));
            accountSN = res.substring(snLoc,res.indexOf('"',snLoc));
         }

         return Promise.resolve();
      });
   } else {
      return Promise.resolve();
   }
}

function getRequestOptions(serviceDef, url) {
   const headers = serviceDef.headers();
   return {
      url: url,
      json: true,
      headers: headers,
   };
}

function doSearch(service, type, term) {
   var serviceDef = getService(service);
   var url = serviceDef.search[type];
   var authenticate = serviceDef.authenticate;

   term = decodeURIComponent(term);

   let newTerm = '';
   let trackPos;
   let artistPos;

   // Check for search type specifiers
   if (term.indexOf(':') > -1) {
      var artist = '';
      var album = '';
      var track  = '';

      const tokens = term.split(' ');
      const fields = [ 'artist', 'album', 'track', 'year' ];
      let tokenIndex = 0;

      var accumulate = function accumulate() {
         let accumulated = '';

         while (tokenIndex < tokens.length) {
            let token = tokens[tokenIndex];
            const splitToken = token.split(':');

            if (splitToken.length > 1 &&
               fields.indexOf(splitToken[0].toLowerCase()) > -1) {
               break;
            }

            accumulated += tokens[tokenIndex] + ' ';
            tokenIndex++;
         }

         return accumulated.trim();
      };

      while (tokenIndex < tokens.length) {
         const token = tokens[tokenIndex++];
         const splitToken = token.split(':');

         if (splitToken.length > 1) {
            const prefix = splitToken[0].toLowerCase();
            const suffix = splitToken[1];

            if (prefix === 'artist') {
               artist = (suffix + ' ' + accumulate()).trim();
            } else if (prefix === 'album') {
               album = (suffix + ' ' + accumulate()).trim();
            } else if (prefix === 'track') {
               track = (suffix + ' ' + accumulate()).trim();
            }
         }
      }

      newTerm = serviceDef.term(type, term, artist, album, track);
   } else {
      newTerm = (service == 'library') ? term : encodeURIComponent(term);
   }

   if (type == 'song') {
      searchType = (trackPos > -1) ? 1 : (artistPos > -1 ? 2 : 0);
   }

   url += newTerm;

   logger.info('search url: ' + url);

   if (service === 'library') {
      return Promise.resolve(libraryDef.searchlib(type, newTerm));
   } else if ((serviceDef.country != '') && (country == '')) {
      return request({url: 'http://ipinfo.io',
         json: true})
         .then((res) => {
            country = res.country;
            url += serviceDef.country + country;
            return authenticate().then(() => request(getRequestOptions(serviceDef, url)));
         });
   } else {
      if (serviceDef.country != '') {
         url += serviceDef.country + country;
      }

      return authenticate().then(() => request(getRequestOptions(serviceDef, url)));
   }
}

function loadTracks(player, service, type, tracksJson) {
   var tracks = getService(service).tracks(type, tracksJson);

   if (service === 'library' && type === 'album') {
      tracks.isArtist = true;
   } else if (type != 'album') {
      tracks.isArtist = searchType == 2;
   }

   return tracks;
}

function search(player, values) {
   const service = values[0];
   const type = values[1];
   const term = values[2];

   if (musicServices.indexOf(service) == -1) {
      return Promise.reject('Invalid music service');
   }

   if (musicTypes.indexOf(type) == -1) {
      return Promise.reject('Invalid type ' + type);
   }

   if ((service == 'library') && ((type == 'load') || libraryDef.nolib())) {
      return libraryDef.load(player, (type == 'load'));
   }

   return getAccountId(player, service).then(() => {
      return doSearch(service, type, term);
   }).then(resList => {
      const serviceDef = getService(service);
      serviceDef.service(player, accountId, accountSN, country);

      if (serviceDef.empty(type, resList)) {
         return Promise.reject('No matches were found');
      } else if (type == 'station' ||
         ((type == 'album' || type =='playlist') && service != 'library')) {
         const uM = serviceDef.urimeta(type, resList);
         return Promise.resolve({
            isUriAndMetadata: true,
            uriAndMetadata: uM,
         });
      } else {
         const tracks = loadTracks(player, service, type, resList);
         return Promise.resolve(tracks);
      }
   });
}

module.exports = function (api) {
   api.registerAction('search', search);
   libraryDef.read();
};
