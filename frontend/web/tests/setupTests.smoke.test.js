import { describe, expect, it } from 'vitest';

describe('test tooling', () => {
  it('runs and has jest-dom matchers available', () => {
    document.body.innerHTML = '<p>hola</p>';
    expect(document.body).toHaveTextContent('hola');
  });
});
