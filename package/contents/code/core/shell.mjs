const QUOTABLE = /^[\x20-\x26\x28-\x7e]*$/;
const HTTPS_URL = /^https:\/\/[\x21-\x26\x28-\x7e]+$/;

export function quote(value) {
  if (typeof value !== 'string' || !QUOTABLE.test(value)) {
    throw new Error('the value cannot be quoted for the shell');
  }
  return "'" + value + "'";
}

export function quoteUrl(url) {
  if (typeof url !== 'string' || !HTTPS_URL.test(url)) {
    throw new Error('only HTTPS URLs without spaces or quotes are allowed');
  }
  return quote(url);
}
