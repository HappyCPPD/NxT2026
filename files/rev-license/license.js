// AcmeSoft Pro 2026 - license verification
// Usage: node license.js <LICENSE-KEY>

const crypto = require('crypto');

const VALID_LICENSE_HASH = '2d53ea2399cf4badb0a3aa97c87ec7c71c74a72aebec48f208c852c5b1045549';
const reward = [93, 72, 154, 176, 118, 123, 159, 176, 72, 103, 232, 231, 53, 3, 206, 232, 23, 40, 219, 4, 252, 203, 62, 26, 198];

function unlockReward() {
  const k = [0x13, 0x37, 0xc0, 0xde];
  return reward.map((b, i) => String.fromCharCode(b ^ k[i % 4] ^ (i * 7 & 0xff))).join('');
}

const license = process.argv[2] || '';
const hash = crypto.createHash('sha256').update(license).digest('hex');

if (hash === VALID_LICENSE_HASH) {
  console.log('License valid! Thanks for buying AcmeSoft Pro.');
  console.log('Your reward: ' + unlockReward());
} else {
  console.log('Invalid license key. Please purchase AcmeSoft Pro for $499.99.');
}
