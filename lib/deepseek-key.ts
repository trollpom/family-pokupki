// Keep key validation independent of an undocumented provider prefix/length.
// Normalize common copy wrappers, then let DeepSeek validate the credential.
export function normalizeDeepseekKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Вставьте полный API-ключ из кабинета DeepSeek.');
  let key = value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  for (let i = 0; i < 2; i++) {
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
    key = key.replace(/^Bearer\s+/i, '').trim();
  }
  if (!key) throw new Error('Поле API-ключа пустое. Скопируйте полный ключ из кабинета DeepSeek.');
  if (/[*•…]|\.{3}/.test(key)) throw new Error('Скопирован скрытый или сокращённый ключ. Нужна полная строка API-ключа из кабинета DeepSeek.');
  if (/^https?:\/\//i.test(key)) throw new Error('Вставлен адрес сайта. В это поле нужно вставить API-ключ DeepSeek.');
  if (/\s/.test(key)) throw new Error('Внутри API-ключа есть пробел или перенос строки. Скопируйте ключ целиком заново.');
  if (key.length > 4096) throw new Error('В поле слишком много текста. Вставьте только API-ключ DeepSeek.');
  if (!/^[\x21-\x7E]+$/.test(key)) throw new Error('В API-ключе есть посторонние символы. Скопируйте оригинальную строку из кабинета DeepSeek.');
  return key;
}
