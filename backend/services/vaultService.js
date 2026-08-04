const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const DEK_LENGTH = 32; // 256 bits

// Base Vault Adapter Interface
class VaultAdapter {
    async getMasterKey() {
        throw new Error('Not implemented');
    }
}

// Local Development Fallback Vault Adapter
class LocalDevVaultAdapter extends VaultAdapter {
    constructor() {
        super();
        if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_VAULT_IN_PROD !== 'true') {
            throw new Error('[VaultService] SECURITY ERROR: Local fallback vault is strictly prohibited in production mode! Set ALLOW_LOCAL_VAULT_IN_PROD=true in Render environment variables to allow using env key vault.');
        }
        console.warn('[VaultService] WARNING: Using local development vault fallback.');
    }

    async getMasterKey() {
        const key = process.env.LOCAL_DEV_MASTER_KEY;
        if (!key || key.length !== 64) {
            throw new Error('[VaultService] Invalid or missing LOCAL_DEV_MASTER_KEY in env (must be 64 hex characters for a 32-byte key)');
        }
        return Buffer.from(key, 'hex');
    }
}

// Production Azure Key Vault Adapter
class AzureVaultAdapter extends VaultAdapter {
    async getMasterKey() {
        const keyVaultUrl = process.env.AZURE_KEYVAULT_URL;
        const secretName = process.env.AZURE_SECRET_NAME || 'broker-master-kek';
        if (!keyVaultUrl) {
            throw new Error('[VaultService] Production error: AZURE_KEYVAULT_URL is missing.');
        }
        try {
            // Lazy load Azure Identity and Secrets packages to prevent startup overhead in dev
            const { DefaultAzureCredential } = require('@azure/identity');
            const { SecretClient } = require('@azure/keyvault-secrets');

            const credential = new DefaultAzureCredential();
            const client = new SecretClient(keyVaultUrl, credential);
            const secret = await client.getSecret(secretName);
            if (!secret.value || secret.value.length !== 64) {
                throw new Error('[VaultService] Retreived master secret from Azure is empty or invalid (must be 64 hex characters)');
            }
            return Buffer.from(secret.value, 'hex');
        } catch (err) {
            throw new Error(`[VaultService] Azure Key Vault retrieval failed: ${err.message}`);
        }
    }
}

class VaultService {
    constructor() {
        this.provider = process.env.VAULT_PROVIDER || 'local';
        this.adapter = null;
        this.initAdapter();
    }

    initAdapter() {
        if (this.provider === 'azure') {
            this.adapter = new AzureVaultAdapter();
        } else if (this.provider === 'local') {
            this.adapter = new LocalDevVaultAdapter();
        } else {
            throw new Error(`[VaultService] Unsupported vault provider: ${this.provider}`);
        }
    }

    async getMasterKey() {
        return await this.adapter.getMasterKey();
    }

    /**
     * Encrypts plain text credential payload with envelope encryption (DEK encrypted by KEK)
     */
    async encrypt(plaintextPayload) {
        const kek = await this.getMasterKey();

        // 1. Generate a random Data Encryption Key (DEK)
        const dek = crypto.randomBytes(DEK_LENGTH);

        // 2. Encrypt plaintext payload with DEK using AES-256-GCM
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
        let ciphertext = cipher.update(plaintextPayload, 'utf8', 'hex');
        ciphertext += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');

        // 3. Encrypt/wrap the DEK with the KEK (Master Key) using AES-256-GCM
        const dekIv = crypto.randomBytes(IV_LENGTH);
        const dekCipher = crypto.createCipheriv(ALGORITHM, kek, dekIv);
        let encryptedDek = dekCipher.update(dek, null, 'hex');
        encryptedDek += dekCipher.final('hex');
        const dekTag = dekCipher.getAuthTag().toString('hex');

        return {
            ciphertext,
            iv: iv.toString('hex'),
            tag,
            encryptedDek,
            dekIv: dekIv.toString('hex'),
            dekTag: dekTag.toString('hex')
        };
    }

    /**
     * Decrypts encrypted credentials payload using KEK to unwrap the DEK
     */
    async decrypt(encryptedObj) {
        const kek = await this.getMasterKey();

        const { ciphertext, iv, tag, encryptedDek, dekIv, dekTag } = encryptedObj;

        // 1. Decrypt/unwrap the DEK using the KEK (Master Key)
        const dekDecipher = crypto.createDecipheriv(ALGORITHM, kek, Buffer.from(dekIv, 'hex'));
        dekDecipher.setAuthTag(Buffer.from(dekTag, 'hex'));
        let dek = dekDecipher.update(Buffer.from(encryptedDek, 'hex'), null);
        dek = Buffer.concat([dek, dekDecipher.final()]);

        // 2. Decrypt ciphertext using the unwrapped DEK
        const decipher = crypto.createDecipheriv(ALGORITHM, dek, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Envelope encrypts and saves/updates credentials in Mongoose BrokerConnection model
     */
    async saveBrokerCredential(userId, credentials, sessionStatus = 'CONNECTED') {
        const BrokerConnection = require('../models/BrokerConnection');
        const plaintext = JSON.stringify(credentials);
        const encrypted = await this.encrypt(plaintext);

        const updated = await BrokerConnection.findOneAndUpdate(
            { userId },
            {
                brokerName: 'angelone',
                encryptedDek: encrypted.encryptedDek,
                dekIv: encrypted.dekIv,
                dekTag: encrypted.dekTag,
                ciphertext: encrypted.ciphertext,
                iv: encrypted.iv,
                tag: encrypted.tag,
                sessionStatus,
                lastLoginTime: new Date(),
                invalidatedAt: null,
                lastAuthError: null
            },
            { upsert: true, returnDocument: 'after' }
        );
        return updated;
    }

    /**
     * Retrieves decrypted credentials from Mongoose BrokerConnection model
     */
    async getBrokerCredential(userId, { ignoreStatus = false } = {}) {
        const BrokerConnection = require('../models/BrokerConnection');
        const connection = await BrokerConnection.findOne({ userId });
        // Allow reauthenticate to read credentials even when DISCONNECTED/REAUTH_REQUIRED.
        // Normal callers (strategies, market data) still get null when DISCONNECTED.
        if (!connection) return null;
        if (!ignoreStatus && connection.sessionStatus === 'DISCONNECTED') return null;

        const plaintext = await this.decrypt({
            ciphertext: connection.ciphertext,
            iv: connection.iv,
            tag: connection.tag,
            encryptedDek: connection.encryptedDek,
            dekIv: connection.dekIv,
            dekTag: connection.dekTag
        });

        return JSON.parse(plaintext);
    }

    /**
     * Marks credentials as invalid or expired without deleting the metadata
     */
    async markCredentialInvalid(userId, errorMsg = 'Session Expired') {
        const BrokerConnection = require('../models/BrokerConnection');
        return await BrokerConnection.findOneAndUpdate(
            { userId },
            {
                sessionStatus: 'REAUTH_REQUIRED',
                lastAuthError: errorMsg,
                invalidatedAt: new Date()
            },
            { returnDocument: 'after' }
        );
    }

    /**
     * Permanent revocation of credentials from MongoDB
     */
    async deleteBrokerCredential(userId) {
        const BrokerConnection = require('../models/BrokerConnection');
        return await BrokerConnection.findOneAndDelete({ userId });
    }

    /**
     * Rotates master KEK for a user's record
     */
    async rotateEncryptionKey(userId, newMasterKeyHex) {
        const BrokerConnection = require('../models/BrokerConnection');
        const connection = await BrokerConnection.findOne({ userId });
        if (!connection) {
            throw new Error('[VaultService] No active broker connection found to rotate keys for');
        }

        // 1. Decrypt current credentials with old KEK
        const currentPlain = await this.getBrokerCredential(userId);
        if (!currentPlain) {
            throw new Error('[VaultService] Cannot rotate keys: current credentials cannot be decrypted');
        }

        // 2. Encrypt DEK with new master key
        const newKek = Buffer.from(newMasterKeyHex, 'hex');
        
        // Decrypt current DEK
        const oldKek = await this.getMasterKey();
        const dekDecipher = crypto.createDecipheriv(ALGORITHM, oldKek, Buffer.from(connection.dekIv, 'hex'));
        dekDecipher.setAuthTag(Buffer.from(connection.dekTag, 'hex'));
        let dek = dekDecipher.update(Buffer.from(connection.encryptedDek, 'hex'), null);
        dek = Buffer.concat([dek, dekDecipher.final()]);

        // Wrap DEK with new KEK
        const newDekIv = crypto.randomBytes(IV_LENGTH);
        const newDekCipher = crypto.createCipheriv(ALGORITHM, newKek, newDekIv);
        let newEncryptedDek = newDekCipher.update(dek, null, 'hex');
        newEncryptedDek += newDekCipher.final('hex');
        const newDekTag = newDekCipher.getAuthTag().toString('hex');

        connection.encryptedDek = newEncryptedDek;
        connection.dekIv = newDekIv.toString('hex');
        connection.dekTag = newDekTag.toString('hex');
        connection.keyVersion += 1;
        await connection.save();

        return connection;
    }
}

module.exports = new VaultService();
