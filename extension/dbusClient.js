import Gio from 'gi://Gio';

const DBusIface = `
<node>
  <interface name="com.sesh.Daemon">
    <method name="SendMessage">
      <arg type="s" name="peer_id" direction="in"/>
      <arg type="s" name="content" direction="in"/>
      <arg type="s" name="msg_id" direction="out"/>
    </method>
    <method name="GetOnlinePeers">
      <arg type="a(sss)" name="peers" direction="out"/>
    </method>
    <method name="GetMyPeerId">
      <arg type="s" name="peer_id" direction="out"/>
    </method>
    <method name="GetConversation">
      <arg type="s" name="peer_id" direction="in"/>
      <arg type="u" name="limit" direction="in"/>
      <arg type="a(ssbstb)" name="messages" direction="out"/>
    </method>
    <method name="ListConversations">
      <arg type="as" name="peer_ids" direction="out"/>
    </method>
    <signal name="PeerOnline">
      <arg type="(ss)"/>
    </signal>
    <signal name="PeerOffline">
      <arg type="(ss)"/>
    </signal>
    <signal name="MessageReceived">
      <arg type="(ssss)"/>
    </signal>
  </interface>
</node>`;

function callRemote(instance, method, args) {
  return new Promise((resolve, reject) => {
    instance[method + 'Remote'](...args, (result, err) => {
      if (err) reject(err);
      else resolve(result[0]);
    });
  });
}

export function makeDbusClient(callbacks) {
  const conn = Gio.DBus.session;
  const proxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);
  const instance = new proxy(conn, 'com.sesh.Daemon', '/com/sesh/Daemon');

  const subs = [];

  subs.push(
    conn.signal_subscribe(
      'com.sesh.Daemon',
      'com.sesh.Daemon',
      'PeerOnline',
      '/com/sesh/Daemon',
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        const [peerId, username] = params.deepUnpack();
        callbacks.onPeerOnline(peerId, username);
      }
    )
  );

  subs.push(
    conn.signal_subscribe(
      'com.sesh.Daemon',
      'com.sesh.Daemon',
      'PeerOffline',
      '/com/sesh/Daemon',
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        const [peerId, username] = params.deepUnpack();
        callbacks.onPeerOffline(peerId, username);
      }
    )
  );

  subs.push(
    conn.signal_subscribe(
      'com.sesh.Daemon',
      'com.sesh.Daemon',
      'MessageReceived',
      '/com/sesh/Daemon',
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        const [peerId, username, content, msgId] = params.deepUnpack();
        callbacks.onMessageReceived(peerId, username, content, msgId);
      }
    )
  );

  function destroy() {
    for (const id of subs) {
      conn.signal_unsubscribe(id);
    }
    subs.length = 0;
  }

  return {
    getOnlinePeers() {
      return callRemote(instance, 'GetOnlinePeers', []);
    },
    sendMessage(peerId, content) {
      return callRemote(instance, 'SendMessage', [peerId, content]);
    },
    getMyPeerId() {
      return callRemote(instance, 'GetMyPeerId', []);
    },
    getConversation(peerId, limit = 50) {
      return callRemote(instance, 'GetConversation', [peerId, limit]);
    },
    listConversations() {
      return callRemote(instance, 'ListConversations', []);
    },
    destroy,
  };
}
