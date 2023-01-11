const fs = require('fs');
const { Account, KeyPair, keyStores, Connection } = require('near-api-js');
const { Account2FA } = require('near-api-js/lib/account_multisig');
const { generateSeedPhrase } = require('near-seed-phrase');
const path = require('path');
const os = require('os');
const { UrlAccountCreator } = require('near-api-js/lib/account_creator');
const { PublicKey } = require('near-api-js/lib/utils/key_pair');

async function createFullAccessKey({ keyStore, networkId }) {
    const keyPair = KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.publicKey.toString();

    await keyStore.setKey(networkId, publicKey, keyPair);

    return publicKey;
}

async function seedAccessKeys({ account, keyStore, keysToCreate, networkId, isMultisig }) {
    const keys = [];
    for (let i = 0; i < keysToCreate; i++) {
        keys.push(await createFullAccessKey({
            account,
            keyStore,
            networkId,
        }));
    }
    await account.addKeys(keys, isMultisig && account.accountId, [
        'add_request',
        'add_request_and_confirm',
        'delete_request',
        'confirm'
    ]);
}

async function addRecoveryMethods({ accountId, connection, detail, kind, seedPhrase }) {
    const account = new Account2FA(connection, accountId, { storage: null });
    await account.postSignedJson('/account/seedPhraseAdded', {
        accountId,
        publicKey: (await connection.signer.getPublicKey(accountId, 'testnet')).toString(),
    });
    await account.postSignedJson('/account/initializeRecoveryMethod', {
        accountId,
        method: { detail, kind },
        seedPhrase,
    });
}

async function deployMultisig({ accountId, connection, detail, kind }) {
    const account = new Account2FA(connection, accountId, { storage: null });
    await account.postSignedJson('/account/seedPhraseAdded', {
        accountId,
        publicKey: (await connection.signer.getPublicKey(accountId, 'testnet')).toString(),
    });
    await account.postSignedJson('/2fa/init', { accountId, method: { detail, kind }});
    await account.deployMultisig(fs.readFileSync(path.join(__dirname, 'contracts/multisig.wasm')));
}

// async function disableMultisig({ accountId, connection }) {
//     const account = new Account2FA(connection, accountId, { storage: null });
//     await account.disable(
//         fs.readFileSync(path.join(os.homedir(), 'workspace/near-wallet/packages/frontend/src/wasm/multisig.wasm')),
//         fs.readFileSync(path.join(os.homedir(), 'Downloads/state_cleanup.wasm'))
//     );
// }

module.exports = {
    createFullAccessKey,
};

if (require.main === module) {
    (async function () {
        const {
            publicKey,
            secretKey,
            seedPhrase,
        } = generateSeedPhrase();

        const accountId = `${(new Date()).valueOf()}-${Math.round(Math.random() * Math.pow(10, 16))}.testnet`;
        const keyStore = new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), '.near-credentials'));
        await keyStore.setKey('testnet', accountId, KeyPair.fromString(secretKey));

        const config = {
            networkId: 'testnet',
            nodeUrl: 'https://rpc.testnet.near.org',
            helperUrl: 'https://helper.testnet.near.org',
            walletUrl: 'https://wallet.testnet.near.org',
        };

        const masterAccount = new Account(Connection.fromConfig({
            ...config,
            masterAccount: 'test.near',
            provider: { type: 'JsonRpcProvider' },
            signer: { type: 'InMemorySigner' },
        }), 'test.near');

        await (new UrlAccountCreator(masterAccount, 'https://helper.testnet.near.org'))
            .createAccount(accountId, PublicKey.fromString(publicKey));

        const account = new Account(Connection.fromConfig({
            ...config,
            provider: { type: 'JsonRpcProvider', args: { url: 'https://rpc.testnet.near.org' } },
            signer: { type: 'InMemorySigner', keyStore },
        }), accountId);

        console.log({
            accountId,
            publicKey,
            secretKey,
            seedPhrase,
        });

        // await account.addKey(PublicKey.fromString(publicKey));

        const [recoveryMethod, recoveryMethodDetail, multisigKeysToCreate] = process.argv.slice(2);
        if (!recoveryMethod) {
            console.warn('no recovery method specified, creating new account');
        } else {
            switch (recoveryMethod) {
            case '2fa-email':
            case '2fa-phone': {
                if (!recoveryMethodDetail) {
                    throw new Error(`email or phone number required for ${recoveryMethod}`);
                }
                await deployMultisig({ accountId, connection: account.connection, detail: recoveryMethodDetail, kind: recoveryMethod });
                break;
            }
            case 'email':
            case 'phone': {
                if (!recoveryMethodDetail) {
                    throw new Error(`email or phone number required for ${recoveryMethod}`);
                }
                await addRecoveryMethods({
                    accountId,
                    connection: account.connection,
                    detail: recoveryMethodDetail,
                    kind: recoveryMethod,
                    seedPhrase,
                });
                break;
            }
            case 'help': {
                console.warn(`
                    usage: node init-account.js (2fa-email|2fa-phone|email|phone) (email-address|phone-number) (number-of-multisig-keys-to-create)
                    example: node init-account.js 2fa-email myname@domain.com 50 # creates 2fa-enabled account w/50 keys
                             node init-account.js email myname@domain.com        # creates account with email recovery method
                `);
                break;
            }
            default: {
                console.warn('invalid recovery method kind, specify one of \'phone\', \'email\', \'2fa-email\', \'2fa-phone\'');
                break;
            }
            }

            if (multisigKeysToCreate) {
                await seedAccessKeys({
                    isMultisig: recoveryMethod.startsWith('2fa'),
                    account,
                    keyStore,
                    keysToCreate: multisigKeysToCreate,
                    networkId: 'testnet',
                });
            }
        }
    }());
}
