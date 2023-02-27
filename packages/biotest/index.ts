import { createKey, getKeys } from '@near-js/biometric-ed25519';

console.log({
    key: createKey('andy'),
    // keys: getKeys('andy'),
});
