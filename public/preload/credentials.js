function redactCredentials(value) {
  return String(value || '')
    .replace(/((?:https?|socks[45]h?):\/\/)[^\s/<>@]+@/gi, '$1[已隐藏]@')
    .replace(/([?&](?:access_token|auth[-_]?token|token|password|secret|api[-_]?key)=)[^\s&#"'<>]*/gi, '$1[已隐藏]');
}

function redactCommandLine(value) {
  return redactCredentials(value).replace(
    /((?:^|\s)(?:-{1,2}|\/)?(?:password|passphrase|passwd|(?:access[-_])?token|api[-_]?key|client[-_]?secret)(?:\s*[=:]\s*|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
    '$1[已隐藏]',
  );
}

module.exports = { redactCredentials, redactCommandLine };
