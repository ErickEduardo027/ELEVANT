import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import EstimatedTag from './EstimatedTag';
import { TAGS } from './statusVocabulary';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('EstimatedTag', () => {
  it('says «est.» as its own text with a dashed outline and no hue', () => {
    expect(TAGS.estimated.texture).toBe('dashed');
    render(<p><span>DM161</span><EstimatedTag className="ml-1" /></p>);
    const tag = screen.getByText('est.');
    expect(tag).toHaveAttribute('data-occ-tag', 'estimated');
    expect(tag.previousElementSibling).toHaveTextContent('DM161');
    const classes = tag.className.split(/\s+/);
    // The texture of «est.»: a dashed outline in secondary ink, plain text, the plate radius.
    expect(classes).toEqual(expect.arrayContaining(['border', 'border-dashed', 'border-occ-muted', 'text-occ-text',
      'rounded-[2px]']));
    expect(classes.filter(name => /occ-(?:accent|warn|danger)|bg-/.test(name))).toEqual([]);
    expect(tag.querySelector('svg')).toBeNull();
    expect(classes.at(-1)).toBe('ml-1');

    // The same word in English.
    resetLanguageForTests('en');
    cleanup();
    render(<LanguageScope><EstimatedTag /></LanguageScope>);
    expect(screen.getByText(TAGS.estimated.en)).toHaveAttribute('data-occ-tag', 'estimated');
  });
});
