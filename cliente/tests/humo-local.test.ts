import { describe, expect, it } from 'vitest';
import { esUrlLocal } from '../scripts/humo-local';

describe('la prueba de humo solo corre contra el servidor local', () => {
  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost', 'https://127.0.0.1/', 'http://[::1]:8080'])(
    '%s es local',
    (url) => expect(esUrlLocal(url)).toBe(true),
  );
  it.each(['https://manual.inia.cl', 'http://10.0.0.5:8080', 'http://localhost.ejemplo.com', 'http://127.0.0.2', 'no es url'])(
    '%s no es local',
    (url) => expect(esUrlLocal(url)).toBe(false),
  );
});
