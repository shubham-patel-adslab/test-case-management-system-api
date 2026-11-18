// A year (leap year included) is the longest range: the trend has one point per day, so the range bounds the
// response size and the work per request.
export const ANALYTICS_RANGE_MAX_DAYS = 366;

export const ANALYTICS_DEFAULT_TIME_ZONE = 'UTC';

// The 400 for `timeZone`, whether the name is malformed (request schema) or one the database doesn't know (service).
export const TIME_ZONE_INVALID_MESSAGE = 'Must be an IANA time zone, e.g. Europe/Berlin';
