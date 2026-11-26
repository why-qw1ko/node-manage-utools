export function redactCredentials(value) {
  return String(value || '')
    .replace(/((?:https?|socks[45]h?):\/\/)[^\s/<>@]+@/gi, '$1[已隐藏]@')
    .replace(/([?&](?:access_token|auth[-_]?token|token|password|secret|api[-_]?key)=)[^\s&#"'<>]*/gi, '$1[已隐藏]');
}
