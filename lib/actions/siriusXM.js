import request from 'request-promise';
import Fuse from 'fuse.js';
import channels from '../sirius-channels.json' with { type: 'json' };

var accountId = '';

function getSiriusXmMetadata(id, parent, title, auth) {
  return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
        xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
        <item id="00092120r%3a${id}" parentID="${parent}" restricted="true"><dc:title>${title}</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
        <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON9479_${auth}</desc></item></DIDL-Lite>`;
}

function getSiriusXmUri(id) {
  return `x-sonosapi-hls:r%3a${id}?sid=37&flags=8480&sn=11`;
}

async function getAccountId(player) {
  accountId = '';

  const res = await request({ url: player.baseUrl + '/status/accounts', json: false });
  var actLoc = res.indexOf('Account Type="9479"');
  if (actLoc != -1) {
    var idLoc = res.indexOf('<UN>', actLoc) + 4;

    accountId = res.substring(idLoc, res.indexOf('</UN>', idLoc));
  }
  return await Promise.resolve();
}

function siriusXM(player, values) {
  var results = [];

  // Used to generate channel data for the channels array. Results are sent to the console after loading Sonos Favorites with a number of SiriusXM Channels
  if (values[0] == 'data') {
    return player.system.getFavorites()
      .then((favorites) => {
        return favorites.reduce(function(promise, item) {
          if (item.uri.startsWith('x-sonosapi-hls:')) {
            var title = item.title.replace("'", '');

            console.log("{fullTitle:'" + title +
              "', channelNum:'" + title.substring(0, title.search(' - ')) +
              "', title:'" + title.substring(title.search(' - ') + 3, title.length) +
              "', id:'" + item.uri.substring(item.uri.search('r%3a') + 4, item.uri.search('sid=') - 1) +
              "', parentID:'" + item.metadata.substring(item.metadata.search('parentID=') + 10, item.metadata.search(' restricted') - 1) + "'},");
          }
          return promise;
        }, Promise.resolve("success"));
      });
  } else
    // Used to send a list of channel numbers specified below in channels for input into an Alexa slot
    if (values[0] == 'channels') {
      var cList = channels.map(channel => channel.channelNum);
      cList.sort(function(a, b) { return a - b; }).map(function(channel) {
        console.log(channel);
      });

      return Promise.resolve("success");
    } else
      // Used to send a list of station titles specified below in channels for input into an Alexa slot
      if (values[0] == 'stations') {
        return Promise.resolve("success");
      } else {
        // Play the specified SiriusXM channel or station

        return getAccountId(player)
          .then(() => {
            if (accountId != '') {
              var searchVal = values[0];
              var fuzzy = new Fuse(channels, { keys: ["channelNum", "title"] });

              results = fuzzy.search(searchVal);
              if (results.length > 0) {
                const channel = results[0];
                const uri = getSiriusXmUri(channel.id);
                const metadata = getSiriusXmMetadata(channel.id, channel.parentID, channel.fullTitle, accountId);

                return player.coordinator.setAVTransport(uri, metadata)
                  .then(() => player.coordinator.play());
              }
            }
          });
      }
}

export default function(api) {
  api.registerAction('siriusxm', siriusXM);
};
