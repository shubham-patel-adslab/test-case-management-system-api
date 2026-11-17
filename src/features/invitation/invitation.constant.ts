// Long enough for a user to act on an email sent before a weekend; an expired link is re-sent by an admin.
export const INVITATION_TTL_HOURS = 72;

// 32 random bytes = 256 bits: unguessable, so the link alone proves the user received the email.
export const INVITATION_TOKEN_BYTES = 32;
// base64url of 32 bytes is 43 characters; anything longer can't be a token we issued.
export const INVITATION_TOKEN_MAX_LENGTH = 64;

// The UI route that reads the token. The token travels in the URL fragment (#token=…): browsers never send
// the fragment to a server or in a Referer header, so it stays out of access logs and third-party requests.
export const INVITATION_UI_PATH = '/set-password';
