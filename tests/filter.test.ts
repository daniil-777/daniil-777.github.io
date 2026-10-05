import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_STATE,
  categoryCounts,
  filterItems,
  fromQuery,
  isActive,
  toQuery,
  topicCounts,
  type FilterItem,
  type FilterState,
} from '../src/lib/filter.ts';

const items: FilterItem[] = [
  { id: 'proctor', category: 'surgical-ai', topics: ['LLM & VLM', 'Medical', 'Real-time'], text: 'ai proctor virtamed llm surgical coach', hasVideo: true },
  { id: 'trainer', category: 'surgical-ai', topics: ['Computer Vision', 'Medical', 'Real-time'], text: 'laparoscopic skills trainer pytorch typescript', hasVideo: true },
  { id: 'astro', category: 'independent', topics: ['Reinforcement Learning', '3D', 'Real-time'], text: 'astro pilot ppo three.js tensorflow.js', hasVideo: true },
  { id: 'pose', category: 'research', topics: ['Computer Vision', '3D', 'Patent'], text: 'camera pose point cloud eth zürich thesis', hasVideo: false },
];
const state = (patch: Partial<FilterState> = {}): FilterState => ({ ...EMPTY_STATE, ...patch });
const ids = (s: FilterState) => filterItems(items, s).map((i) => i.id);

describe('filterItems', () => {
  it('returns everything for the empty state', () => {
    assert.deepEqual(ids(state()), ['proctor', 'trainer', 'astro', 'pose']);
  });

  it('filters by category', () => {
    assert.deepEqual(ids(state({ category: 'surgical-ai' })), ['proctor', 'trainer']);
  });

  it('requires every selected topic', () => {
    assert.deepEqual(ids(state({ topics: ['Real-time'] })), ['proctor', 'trainer', 'astro']);
    assert.deepEqual(ids(state({ topics: ['Real-time', 'Medical'] })), ['proctor', 'trainer']);
    assert.deepEqual(ids(state({ topics: ['Real-time', 'Patent'] })), []);
  });

  it('keeps only projects with video when asked', () => {
    assert.deepEqual(ids(state({ videoOnly: true })), ['proctor', 'trainer', 'astro']);
  });

  it('matches every search word, in any order, ignoring case', () => {
    assert.deepEqual(ids(state({ query: 'Pilot ASTRO' })), ['astro']);
    assert.deepEqual(ids(state({ query: 'astro surgical' })), []);
  });

  it('matches partial words and ignores accents', () => {
    assert.deepEqual(ids(state({ query: 'lapar' })), ['trainer']);
    assert.deepEqual(ids(state({ query: 'zurich' })), ['pose']);
  });

  it('searches topic names as well as free text', () => {
    assert.deepEqual(ids(state({ query: 'patent' })), ['pose']);
  });

  it('combines all constraints', () => {
    assert.deepEqual(ids(state({ category: 'surgical-ai', topics: ['Medical'], query: 'pytorch', videoOnly: true })), ['trainer']);
  });
});

describe('topicCounts', () => {
  const topics = ['Real-time', 'Medical', '3D', 'Patent', 'Computer Vision'];

  it('counts matches per topic for the empty state', () => {
    assert.deepEqual(topicCounts(items, state(), topics), {
      'Real-time': 3, Medical: 2, '3D': 2, Patent: 1, 'Computer Vision': 2,
    });
  });

  it('counts what selecting one more topic would leave', () => {
    const counts = topicCounts(items, state({ topics: ['Real-time'] }), topics);
    assert.equal(counts['Medical'], 2);
    assert.equal(counts['3D'], 1);
    assert.equal(counts['Patent'], 0);
    assert.equal(counts['Real-time'], 3, 'a selected topic shows the current result count');
  });

  it('respects the category', () => {
    const counts = topicCounts(items, state({ category: 'research' }), topics);
    assert.equal(counts['Real-time'], 0);
    assert.equal(counts['Patent'], 1);
  });
});

describe('categoryCounts', () => {
  it('ignores the selected category but respects everything else', () => {
    const counts = categoryCounts(items, state({ category: 'research', topics: ['Real-time'] }), ['surgical-ai', 'independent', 'research']);
    assert.deepEqual(counts, { all: 3, 'surgical-ai': 2, independent: 1, research: 0 });
  });
});

describe('isActive', () => {
  it('is false only for the empty state', () => {
    assert.equal(isActive(state()), false);
    assert.equal(isActive(state({ query: '  ' })), false);
    assert.equal(isActive(state({ query: 'x' })), true);
    assert.equal(isActive(state({ category: 'research' })), true);
    assert.equal(isActive(state({ topics: ['3D'] })), true);
    assert.equal(isActive(state({ videoOnly: true })), true);
  });
});

describe('URL round trip', () => {
  const valid = { categories: ['surgical-ai', 'independent', 'research'], topics: ['Real-time', 'LLM & VLM', '3D'] };

  it('serialises the empty state to an empty string', () => {
    assert.equal(toQuery(state()), '');
  });

  it('round-trips a full state', () => {
    const full = state({ category: 'research', topics: ['3D', 'LLM & VLM'], query: 'point cloud', videoOnly: true });
    assert.deepEqual(fromQuery(toQuery(full), valid), full);
  });

  it('drops unknown categories and topics', () => {
    assert.deepEqual(fromQuery('cat=nope&topic=3D&topic=Bogus', valid), state({ topics: ['3D'] }));
  });

  it('accepts a leading question mark', () => {
    assert.deepEqual(fromQuery('?cat=independent', valid), state({ category: 'independent' }));
  });
});
