import crypto from 'node:crypto';

/**
 * Manages device pairing and authentication for remote / local agent runtimes.
 */
export class DeviceManager {
  constructor() {
    this.devices = new Map();
    this.pairingTokens = new Map();
  }

  createPairingToken(metadata = {}) {
    const token = `pair_${crypto.randomBytes(16).toString('hex')}`;
    this.pairingTokens.set(token, {
      token,
      metadata,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });
    return token;
  }

  pairDevice(token, deviceInfo = {}) {
    const record = this.pairingTokens.get(token);
    if (!record) {
      throw new Error('Invalid or expired pairing token.');
    }
    if (Date.now() > record.expiresAt) {
      this.pairingTokens.delete(token);
      throw new Error('Pairing token has expired.');
    }

    const deviceId = `dev_${crypto.randomBytes(8).toString('hex')}`;
    const device = {
      id: deviceId,
      name: deviceInfo.name || 'Local Developer Machine',
      platform: deviceInfo.platform || 'unknown',
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      status: 'paired',
      metadata: record.metadata
    };

    this.devices.set(deviceId, device);
    this.pairingTokens.delete(token);
    return device;
  }

  listDevices() {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  revokeDevice(deviceId) {
    return this.devices.delete(deviceId);
  }
}

export const deviceManager = new DeviceManager();
