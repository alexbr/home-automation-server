'use strict';
function setAVTransportURI(player, values) {
  return player.setAVTransport(decodeURIComponent(values[0]));
}

export default function(api) {
  api.registerAction('setavtransporturi', setAVTransportURI);
}
