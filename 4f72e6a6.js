const fs = require('fs');
const crypto = require('crypto');
const tokenFile = process.argv[2];
if (!tokenFile) {
  console.error('Usage: node manage-token.js <token-file-path>');
  process.exit(1);
}
function isValidToken(t) {
  return typeof t === 'string' && t.length >= 16 && /^[a-zA-Z0-9_\-]+$/.test(t);
}
let token = null;
try {
  if (fs.existsSync(tokenFile)) {
    const raw = fs.readFileSync(tokenFile, 'utf8');
    const trimmed = raw.trim();
    if (isValidToken(trimmed)) {
      token = trimmed;
    } else {
      console.error('Existing token file content is invalid (too short or non-alphanumeric). Generating new token.');
    }
  }
} catch (err) {
  console.error('Could not read existing token file:', err.message);
}
if (!token) {
  token = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(tokenFile, token, 'utf8');
    console.error('Generated new token and saved to ' + tokenFile);
  } catch (err) {
    console.error('Could not write token file:', err.message);
    process.exit(1);
  }
}
if (process.stdout.isTTY) {
  console.log(token);
} else {
  process.stdout.write(token);
}
process.exit(0);
