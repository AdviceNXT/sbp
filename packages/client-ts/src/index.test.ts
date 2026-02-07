import { describe, it, expect } from 'vitest';
import { SbpClient, SbpAgent } from './index.js';

describe('SbpClient', () => {
  it('should be instantiable', () => {
    const client = new SbpClient();
    expect(client).toBeDefined();
  });
});

describe('SbpAgent', () => {
  it('should be instantiable', () => {
    const agent = new SbpAgent('test-agent');
    expect(agent).toBeDefined();
  });
});
