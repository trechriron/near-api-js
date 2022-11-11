const fs = require('fs');
const { KeyPair, keyStores, connect } = require('near-api-js');
const { Account2FA } = require('near-api-js/lib/account_multisig');
const path = require('path');
const readline  = require('readline');
const os = require('os');

async function createFullAccessKey({ account, keyStore, networkId }) {
    const keyPair = KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.publicKey.toString();

    await keyStore.setKey(networkId, publicKey, keyPair);

    return publicKey;
}

async function seedAccessKeys({ account, keyStore, keysToCreate, networkId }) {
    const keys = [];
    for (let i = 0; i < keysToCreate; i++) {
        keys.push(await createFullAccessKey({
            account,
            keyStore,
            networkId,
        }));
    }
    await account.addKeys(keys, account.accountId, [
        'add_request',
        'add_request_and_confirm',
        'delete_request',
        'confirm'
    ]);
}

async function deleteAccessKeys({ account, whitelistedKeys }) {
    const getKeys = async () => (await account.getAccessKeys())
        .map((key) => key.public_key)
        .filter((publicKey) => !whitelistedKeys.includes(publicKey));

    let keys = await getKeys();
    const totalKeys = keys.length;
    while (keys.length) {
        keys = await getKeys();
        await account.deleteKeys(keys.slice(0, 100));
    }
    console.log({ keys: totalKeys });
}

async function deployMultisig({ accountId, connection }) {
    const account = new Account2FA(connection, accountId, { storage: null });
    await account.postSignedJson('/2fa/init', { accountId, method: { detail: 'andy@near.org', kind: '2fa-email' }});
    await account.deployMultisig(fs.readFileSync(path.join(os.homedir(), 'workspace/near-wallet/packages/frontend/src/wasm/multisig.wasm')));
}

async function disableMultisig({ accountId, connection }) {
    const account = new Account2FA(connection, accountId, { storage: null });
    await account.disable(
        fs.readFileSync(path.join(os.homedir(), 'workspace/near-wallet/packages/frontend/src/wasm/multisig.wasm')),
        fs.readFileSync(path.join(os.homedir(), 'Downloads/state_cleanup.wasm'))
    );
}

module.exports = {
    createFullAccessKey,
};

if (require.main === module) {
    (async function () {
        const accountId = 'gormp.testnet';
        const networkId = 'testnet';
        const nodeUrl = 'https://rpc.testnet.near.org';

        const CREDENTIALS_DIR = '.near-credentials';
        const credentialsPath = path.join(os.homedir(), CREDENTIALS_DIR);
        const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

        const near = await connect({ keyStore, networkId, nodeUrl });
        const account = await near.account(accountId);

        const recoveryPublicKey = 'ed25519:69FQR4c1ccAyYnto8cqA9hxxkRfZqnBQsy4yktVBKzmN';
        const signingPublicKey = 'ed25519:AHQXHW7zH5vS2EbNsyPaxKyB8Vgb2vJhr9aNXH1KeWQ2';

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const msAccount = new Account2FA(near.connection, accountId, {
            getCode: () => new Promise((resolve) => {
                rl.question('Enter code: ', input => resolve(input));
            }),
            storage: null,
        });
        console.log({
            status: 'start',
            laks: (await msAccount.get2faLimitedAccessKeys()).length,
            keys: (await msAccount.getAccessKeys()).length,
        });

        // await deleteAccessKeys({ account, whitelistedKeys: [recoveryPublicKey, signingPublicKey] });
        // await deployMultisig({ accountId, connection: near.connection });
        await seedAccessKeys({
            account,
            keyStore,
            keysToCreate: 48,
            networkId,
        });

        // await msAccount.batchConvertKeys(signingPublicKey);
        // await deleteAccessKeys({ account, whitelistedKeys: [recoveryPublicKey, signingPublicKey] });
        rl.close();

        console.log({
            status: 'end',
            laks: (await msAccount.get2faLimitedAccessKeys()).length,
            keys: (await msAccount.getAccessKeys()).length,
        });
    }());
}
