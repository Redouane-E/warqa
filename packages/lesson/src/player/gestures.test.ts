// What a finger did, which way is the next page, and where a dragged sheet settles (redesign phase 5).
import { describe, expect, it } from 'vitest';
import { classify, settle, stepOf } from './gestures.js';

describe('gestures', () => {
  it('tells a tap, a swipe and nothing apart', () => {
    expect(classify(3, -4, 120)).toBe('tap');
    // too slow for a tap, too short for a swipe
    expect(classify(3, 4, 700)).toBe(null);
    expect(classify(-60, 10, 250)).toBe('left');
    expect(classify(80, -20, 400)).toBe('right');
    // more up and down than sideways: the page scrolls, no step
    expect(classify(60, 50, 250)).toBe(null);
    // too slow
    expect(classify(-200, 0, 900)).toBe(null);
    // on a narrow surface 15 % is enough
    expect(classify(-40, 0, 200, 240)).toBe('left');
    expect(classify(-40, 0, 200, 1000)).toBe(null);
  });

  it('turns the page the way the language reads', () => {
    expect(stepOf('left', 'ltr')).toBe(1);
    expect(stepOf('right', 'ltr')).toBe(-1);
    expect(stepOf('right', 'rtl')).toBe(1);
    expect(stepOf('left', 'rtl')).toBe(-1);
  });

  it('settles a dragged sheet at the nearest stop, or the way it was flung', () => {
    const stops = [0, 440, 780];
    expect(settle(stops, 470)).toBe(440);
    expect(settle(stops, 700)).toBe(780);
    // below 60 % of half height: closed
    expect(settle(stops, 250)).toBe(0);
    expect(settle(stops, 280)).toBe(440);
    // a fling up from half goes to full; down from full goes to half; down from half closes
    expect(settle(stops, 460, 0.8)).toBe(780);
    expect(settle(stops, 760, -0.9)).toBe(440);
    expect(settle(stops, 420, -0.9)).toBe(0);
    // a sheet with one open stop: let go low, it closes; high, it stays
    expect(settle([0, 520], 200)).toBe(0);
    expect(settle([0, 520], 400)).toBe(520);
  });
});
