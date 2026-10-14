// The pinned upstream Noise state machine owns handshakes, cipher states and nonces.
// Every cryptographic primitive is supplied synchronously by CryptoKit in JavaScriptCore.
import { XXHandshakeState } from '../../node_modules/@chainsafe/libp2p-noise/dist/src/protocol.js';
import { Uint8ArrayList } from 'uint8arraylist';
const flat = data => data instanceof Uint8Array ? data : data.subarray();
const call = (op, args = {}) => nativeCrypto(op, args);
const decode = data => call('decode', { data });
const encode = data => call('encode', { data: flat(data) });
globalThis.TextEncoder = class { encode(text) { return call('utf8', { text }); } };
const primitives = {
  generateKeypair: () => call('keypair'),
  dh: (key, pub) => call('dh', { key: key.privateKey, pub: flat(pub) }),
  hash: data => call('hash', { data: flat(data) }),
  hkdf: (key, data) => { const bytes = call('hkdf', { key, data: flat(data) }); return [bytes.slice(0, 32), bytes.slice(32, 64), bytes.slice(64)]; },
  encrypt: (data, nonce, ad, key) => call('encrypt', { data: flat(data), nonce, ad, key }),
  decrypt: (data, nonce, ad, key) => call('decrypt', { data: flat(data), nonce, ad, key }),
};
const sessions = new Map();
let next = 0;
const empty = new Uint8Array();
globalThis.noiseSession = command => {
  try {
    if (command.op === 'create') {
      if (sessions.size >= 8) throw Error('Too many encrypted connections');
      const s = primitives.generateKeypair();
      const xx = new XXHandshakeState({ crypto: primitives, protocolName: 'Noise_XX_25519_ChaChaPoly_SHA256', initiator: command.initiator, prologue: empty, s });
      const id = String(++next);
      sessions.set(id, { xx, stage: command.initiator ? 'writeA' : 'readA' });
      return JSON.stringify({ id, publicKey: encode(s.publicKey) });
    }
    if (command.op === 'close') { sessions.delete(command.id); return '{}'; }
    const state = sessions.get(command.id);
    if (!state) throw Error('Encrypted connection closed');
    const { xx } = state;
    const bytes = () => new Uint8ArrayList(decode(command.data));
    let result;
    if (command.op === 'writeA' && state.stage === 'writeA') { result = { data: encode(xx.writeMessageA(empty)) }; state.stage = 'readB'; }
    else if (command.op === 'readA' && state.stage === 'readA') { xx.readMessageA(bytes()); result = {}; state.stage = 'writeB'; }
    else if (command.op === 'writeB' && state.stage === 'writeB') { result = { data: encode(xx.writeMessageB(decode(command.data))) }; state.stage = 'readC'; }
    else if (command.op === 'readB' && state.stage === 'readB') { result = { data: encode(xx.readMessageB(bytes())), remoteStatic: encode(xx.rs) }; state.stage = 'writeC'; }
    else if (command.op === 'writeC' && state.stage === 'writeC') { result = { data: encode(xx.writeMessageC(decode(command.data))) }; state.stage = 'ready'; }
    else if (command.op === 'readC' && state.stage === 'readC') { result = { data: encode(xx.readMessageC(bytes())), remoteStatic: encode(xx.rs) }; state.stage = 'ready'; }
    else if (command.op === 'split' && state.stage === 'ready') {
      const [first, second] = xx.ss.split();
      state.send = xx.initiator ? first : second; state.receive = xx.initiator ? second : first;
      delete state.xx; state.stage = 'transport'; result = {};
    } else if ((command.op === 'encrypt' || command.op === 'decrypt') && state.stage === 'transport') {
      if (!Array.isArray(command.records) || command.records.length > 16) throw Error('Invalid encrypted batch');
      result = { records: command.records.map(record => {
        const data = decode(record);
        if (data.length > (command.op === 'encrypt' ? 65519 : 65535) || (command.op === 'decrypt' && data.length < 16)) throw Error('Invalid encrypted record');
        return encode(command.op === 'encrypt' ? state.send.encryptWithAd(empty, data) : state.receive.decryptWithAd(empty, data));
      }) };
    } else throw Error('Invalid encryption state');
    return JSON.stringify(result);
  } catch {
    sessions.delete(command.id);
    throw Error('Encrypted connection failed');
  }
};
