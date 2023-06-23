import Y from 'yjs';
import { writeUpdate, readSyncMessage, writeSyncStep1 } from 'y-protocols/sync';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

import { encoding } from 'lib0';
import { decoding } from 'lib0';

import debounce from 'lodash.debounce';

import { callbackHandler } from './callback';
import { isCallbackSet } from './callback';
import { RedisPersistence } from 'y-redis';

const CALLBACK_DEBOUNCE_WAIT =
  parseInt(process.env.CALLBACK_DEBOUNCE_WAIT as string) || 2000;
const CALLBACK_DEBOUNCE_MAXWAIT =
  parseInt(process.env.CALLBACK_DEBOUNCE_MAXWAIT as string) || 10000;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;
const wsReadyStateClosing = 2; // eslint-disable-line
const wsReadyStateClosed = 3; // eslint-disable-line

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0';

type Persistence = {
  bindState: (a: string, b: WSSharedDoc) => void;
  writeState: (a: string, b: WSSharedDoc) => Promise<any>;
  provider: any;
} | null;

let persistence: Persistence = null;

const REDIS_URI = process.env.REDIS_URI;

if (typeof REDIS_URI === 'string') {
  console.info('Persisting documents to "' + REDIS_URI + '"');
  const rp = new RedisPersistence({ redisOpts: REDIS_URI });
  persistence = {
    provider: rp,
    bindState: async (docName, ydoc) => {
      rp.closeDoc(docName);
      return rp.bindState(docName, ydoc);
    },
    writeState: async (docName, ydoc) => {},
  };
}

export const setPersistence = (persistence_: Persistence) => {
  persistence = persistence_;
};

export const getPersistence = (): Persistence => persistence;

export const docs: Map<string, WSSharedDoc> = new Map();

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2

const updateHandler = (update: Uint8Array, origin: any, doc: WSSharedDoc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_: any, conn: any) => send(doc, conn, message));
};

export class WSSharedDoc extends Y.Doc {
  public name: string;
  public conns: Map<Object, Set<number>>;
  public awareness: Awareness;

  constructor(name: string) {
    super({ gc: gcEnabled });
    this.name = name;
    this.conns = new Map();
    this.awareness = new Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = (
      {
        added,
        updated,
        removed,
      }: {
        added: Array<number>;
        updated: Array<number>;
        removed: Array<number>;
      },
      conn: Object | null
    ) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs =
          /** @type {Set<number>} */ this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => {
            connControlledIDs.add(clientID);
          });
          removed.forEach((clientID) => {
            connControlledIDs.delete(clientID);
          });
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    };

    this.awareness.on('update', awarenessChangeHandler);
    this.on('update', updateHandler);

    if (isCallbackSet) {
      this.on(
        'update',
        debounce(callbackHandler, CALLBACK_DEBOUNCE_WAIT, {
          maxWait: CALLBACK_DEBOUNCE_MAXWAIT,
        })
      );
    }
  }
}

export const getYDoc = (docname: string, gc = true): WSSharedDoc => {
  const createDoc = () => {
    const doc = new WSSharedDoc(docname);
    doc.gc = gc;
    if (persistence !== null) persistence.bindState(docname, doc);
    docs.set(docname, doc);
    return doc;
  };

  let set = docs.get(docname);
  if (set === undefined) docs.set(docname, (set = createDoc()));
  return set;
};

const messageListener = (conn: any, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        readSyncMessage(decoder, encoder, doc, conn);

        // If the `encoder` only contains the type of reply message and no
        // message, there is no need to send the message. When `encoder` only
        // contains the type of reply, its length is 1.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
    }
  } catch (err) {
    console.error(err);
    doc.emit('error', [err]);
  }
};

const closeConn = (doc: WSSharedDoc, conn: any) => {
  if (doc.conns.has(conn)) {
    const controlledIds: Set<number> | undefined = doc.conns.get(conn);
    if (!controlledIds) return;
    doc.conns.delete(conn);
    removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    if (doc.conns.size === 0 && persistence !== null) {
      // if persisted, we store state and destroy ydocument
      persistence.writeState(doc.name, doc).then(() => {
        doc.destroy();
      });
      docs.delete(doc.name);
    }
  }
  conn.close();
};

const send = (doc: WSSharedDoc, conn: any, m: Uint8Array) => {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    closeConn(doc, conn);
  }
  try {
    conn.send(m, (err: any) => {
      err != null && closeConn(doc, conn);
    });
  } catch (e) {
    closeConn(doc, conn);
  }
};

const pingTimeout = 30000;

export const setupWSConnection = (
  conn: any,
  req: any,
  { docName = req.url.slice(1).split('?')[0], gc = true }: any = {}
) => {
  conn.binaryType = 'arraybuffer';

  const doc: WSSharedDoc = getYDoc(docName, gc);

  doc.conns.set(conn, new Set());

  conn.on('message', (message: ArrayBuffer) =>
    messageListener(conn, doc, new Uint8Array(message))
  );

  // Check if connection is still alive
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (e) {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);

  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });

  conn.on('pong', () => {
    pongReceived = true;
  });

  // put the following in a variables in a block so the interval handlers don't keep in in scope
  {
    // send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
      );
      send(doc, conn, encoding.toUint8Array(encoder));
    }
  }
};
